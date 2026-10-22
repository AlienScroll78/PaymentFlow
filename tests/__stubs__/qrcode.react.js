'use strict';

// Stub for qrcode.react used in root-level jest tests.
// Renders a minimal SVG placeholder with the value accessible via data-testid.

const React = require('react');

function QRCodeSVG({ value, ...props }) {
  return React.createElement('svg', {
    'data-testid': 'qr-code',
    role: 'img',
    'aria-label': `QR code: ${value}`,
    ...props,
  });
}

module.exports = { QRCodeSVG };
