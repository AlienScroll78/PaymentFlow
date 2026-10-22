/**
 * PaymentStatusTimeline — Issue #3
 *
 * A reusable timeline component that renders payment status transitions
 * consistently across list and detail views.
 *
 * Supports all canonical payment statuses (PENDING, SUBMITTED, SUCCESS,
 * FAILED, DISPUTED, REFUNDED, INVALID) plus an unknown-status fallback.
 *
 * Accessibility
 * -------------
 * - Renders as an <ol> so screen readers receive ordered status information.
 * - Each step is a <li role="listitem">.
 * - The active/current status has aria-current="step".
 * - Timestamps use <time datetime={isoString}> for machine-readable dates.
 * - Icons are aria-hidden; status label provides the accessible text.
 *
 * @param {object}   props
 * @param {Array}    [props.payments]        Array of { status, createdAt, txHash } for history timeline.
 * @param {string}   [props.currentStatus]   Single status for standalone indicator mode.
 * @param {boolean}  [props.compact=false]   Compact layout for list views.
 * @param {string}   [props.className]       Additional CSS class.
 */
import React from 'react';
import { PAYMENT_STATUS, PAYMENT_STATUS_LABELS, isTerminalStatus } from '../utils/paymentStatus';

const STATUS_STYLE = {
  [PAYMENT_STATUS.PENDING]:   { color: 'var(--warning)',    icon: '⏳', badgeClass: 'badge-warning'  },
  [PAYMENT_STATUS.SUBMITTED]: { color: 'var(--info)',       icon: '↥',  badgeClass: 'badge-info'     },
  [PAYMENT_STATUS.SUCCESS]:   { color: 'var(--success)',    icon: '✓',  badgeClass: 'badge-success'  },
  [PAYMENT_STATUS.FAILED]:    { color: 'var(--danger)',     icon: '✗',  badgeClass: 'badge-danger'   },
  [PAYMENT_STATUS.DISPUTED]:  { color: 'var(--warning)',    icon: '⚠',  badgeClass: 'badge-warning'  },
  [PAYMENT_STATUS.REFUNDED]:  { color: 'var(--text-muted)', icon: '↺', badgeClass: 'badge-neutral'  },
  [PAYMENT_STATUS.INVALID]:   { color: 'var(--danger)',     icon: '⊗',  badgeClass: 'badge-danger'   },
};

const UNKNOWN_STYLE = { color: 'var(--text-muted)', icon: '?', badgeClass: 'badge-neutral' };

export function getStatusStyle(status) {
  return STATUS_STYLE[(status || '').toUpperCase()] || UNKNOWN_STYLE;
}

export function getStatusLabel(status) {
  if (!status) return 'Unknown';
  return PAYMENT_STATUS_LABELS[(status || '').toUpperCase()] || status;
}

export function StatusIndicator({ status, compact }) {
  const style = getStatusStyle(status);
  const label = getStatusLabel(status);
  const terminal = isTerminalStatus(status);

  return (
    <span
      className={[
        'payment-status-indicator',
        compact ? 'payment-status-indicator--compact' : '',
        style.badgeClass,
        terminal ? 'payment-status-indicator--terminal' : '',
      ].filter(Boolean).join(' ')}
      style={{ color: style.color }}
      aria-label={`Payment status: ${label}`}
    >
      <span aria-hidden="true" className="payment-status-indicator__icon">
        {style.icon}
      </span>
      <span className="payment-status-indicator__label">{label}</span>
    </span>
  );
}

export function StatusTimeline({ payments, compact }) {
  if (!payments || payments.length === 0) {
    return (
      <p className="payment-status-timeline__empty" role="status">
        No payment history available.
      </p>
    );
  }

  const lastIndex = payments.length - 1;

  return (
    <ol
      className={['payment-status-timeline', compact ? 'payment-status-timeline--compact' : ''].filter(Boolean).join(' ')}
      aria-label="Payment status history"
    >
      {payments.map((payment, idx) => {
        const status = payment.status;
        const style = getStatusStyle(status);
        const label = getStatusLabel(status);
        const isActive = idx === lastIndex;
        const terminal = isTerminalStatus(status);
        const isoDate = payment.createdAt || null;

        return (
          <li
            key={payment.txHash || `step-${idx}`}
            className={[
              'payment-status-timeline__step',
              isActive ? 'payment-status-timeline__step--active' : '',
              terminal ? 'payment-status-timeline__step--terminal' : '',
            ].filter(Boolean).join(' ')}
            aria-current={isActive ? 'step' : undefined}
          >
            <span
              className={`payment-status-timeline__dot ${style.badgeClass}`}
              style={{ background: style.color }}
              aria-hidden="true"
            >
              {style.icon}
            </span>
            <span className="payment-status-timeline__content">
              <span className="payment-status-timeline__label">{label}</span>
              {isoDate && (
                <time className="payment-status-timeline__time" dateTime={isoDate}>
                  {new Date(isoDate).toLocaleString()}
                </time>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function PaymentStatusTimeline({ payments, currentStatus, compact = false, className = '' }) {
  if (payments && payments.length > 0) {
    return (
      <div className={['payment-status-timeline-wrapper', className].filter(Boolean).join(' ')}>
        <StatusTimeline payments={payments} compact={compact} />
      </div>
    );
  }

  if (currentStatus !== undefined && currentStatus !== null) {
    return (
      <div className={['payment-status-timeline-wrapper', className].filter(Boolean).join(' ')}>
        <StatusIndicator status={currentStatus} compact={compact} />
      </div>
    );
  }

  return null;
}
