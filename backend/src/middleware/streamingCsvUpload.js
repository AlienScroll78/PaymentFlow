'use strict';

/**
 * Streaming CSV upload middleware.
 *
 * Bounds and validates a multipart/form-data CSV upload before the request
 * body reaches any controller:
 *
 *  Byte limit  — Busboy fileSize limit rejects oversized uploads with 413
 *                before a single row is parsed (no full-file buffering).
 *  Row limit   — Exceeded mid-stream: stream is destroyed, 400 returned.
 *  Column limit — Exceeded per-row: stream is destroyed, 400 returned.
 *  Extension   — Must end in .csv; 400 otherwise.
 *  MIME type   — Must be text/csv, application/csv, or application/vnd.ms-excel.
 *  Headers     — Optional `requiredHeaders` list; 400 CSV_MISSING_HEADERS when
 *                any required column is absent from the first data row.
 *
 * On success:
 *  req.parsedRows — array of row objects keyed by CSV header names
 *  req.csvHeaders — array of column names (from the first data row's keys)
 */

const Busboy = require('busboy');
const csv = require('csv-parser');

function streamingCsvUpload(options = {}) {
  const maxSize = options.maxSize || parseInt(process.env.CSV_MAX_SIZE_BYTES, 10) || 5 * 1024 * 1024;
  const maxRows = options.maxRows || parseInt(process.env.CSV_MAX_ROWS, 10) || 10000;
  const maxColumns = options.maxColumns || parseInt(process.env.CSV_MAX_COLUMNS, 10) || 20;
  // Optional list of column names that MUST be present in the CSV header row.
  // e.g. ['studentId', 'name', 'class']
  const requiredHeaders = Array.isArray(options.requiredHeaders) ? options.requiredHeaders : [];

  return (req, res, next) => {
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      return next();
    }

    let rowCount = 0;
    const rows = [];
    let aborted = false;
    let headersValidated = false;

    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: maxSize },
      defParamCharset: 'utf-8',
    });

    const allowedMimeTypes = ['text/csv', 'application/csv', 'application/vnd.ms-excel'];

    bb.on('file', (fieldname, file, info) => {
      if (fieldname !== 'file') {
        file.resume();
        return;
      }

      const filename = info.filename || '';
      const mimeType = info.mimeType || info.mime || '';

      if (!filename.toLowerCase().endsWith('.csv')) {
        aborted = true;
        file.resume();
        if (!res.headersSent) {
          return res.status(400).json({
            error: 'Uploaded file must have a .csv extension',
            code: 'CSV_INVALID_EXTENSION',
          });
        }
        return;
      }

      if (!allowedMimeTypes.includes(mimeType.toLowerCase())) {
        aborted = true;
        file.resume();
        if (!res.headersSent) {
          return res.status(400).json({
            error: `Uploaded file must be text/csv or application/csv, got ${mimeType}`,
            code: 'CSV_INVALID_MIME_TYPE',
          });
        }
        return;
      }

      file
        .pipe(csv())
        .on('data', (row) => {
          if (aborted) return;

          rowCount++;

          // ── Header validation (first data row only) ────────────────────────
          // csv-parser keys each row by its header column names.  On the first
          // row we know what columns the file actually contains, so we validate
          // required headers here — early, before any data is accepted.
          if (!headersValidated) {
            headersValidated = true;
            const presentHeaders = Object.keys(row);
            req.csvHeaders = presentHeaders;

            if (requiredHeaders.length > 0) {
              const missingColumns = requiredHeaders.filter(
                (h) => !presentHeaders.includes(h)
              );
              if (missingColumns.length > 0) {
                aborted = true;
                file.destroy();
                if (!res.headersSent) {
                  return res.status(400).json({
                    error: `CSV is missing required columns: ${missingColumns.join(', ')}`,
                    code: 'CSV_MISSING_HEADERS',
                    missingColumns,
                  });
                }
                return;
              }
            }
          }

          if (rowCount > maxRows) {
            aborted = true;
            file.destroy();
            if (!res.headersSent) {
              return res.status(400).json({
                error: `CSV exceeds maximum row limit of ${maxRows}`,
                code: 'CSV_TOO_MANY_ROWS',
              });
            }
            return;
          }

          if (Object.keys(row).length > maxColumns) {
            aborted = true;
            file.destroy();
            if (!res.headersSent) {
              return res.status(400).json({
                error: `Row ${rowCount + 1} has too many columns. Max is ${maxColumns}`,
                code: 'CSV_INVALID_FORMAT',
              });
            }
            return;
          }

          rows.push(row);
        })
        .on('end', () => {
          if (!aborted && !res.headersSent) {
            req.parsedRows = rows;
            next();
          }
        })
        .on('error', (err) => {
          if (aborted) return;
          aborted = true;
          next(err);
        });
    });

    bb.on('limit', () => {
      if (aborted) return;
      aborted = true;
      req.destroy();
      if (!res.headersSent) {
        res.status(413).json({
          error: `CSV file exceeds maximum allowed size of ${maxSize} bytes`,
          code: 'CSV_TOO_LARGE',
        });
      }
    });

    bb.on('error', (err) => {
      if (aborted) return;
      aborted = true;
      next(err);
    });

    bb.on('close', () => {
      if (!aborted && !res.headersSent) {
        if (!req.parsedRows) {
          return res.status(400).json({
            error: 'Provide a CSV file (field "file") or a JSON body with { "students": [...] }',
            code: 'VALIDATION_ERROR',
          });
        }
      }
    });

    req.pipe(bb);
  };
}

module.exports = streamingCsvUpload;
