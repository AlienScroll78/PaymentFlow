'use strict';

// Stub for react-i18next used in root-level jest tests
// Returns the i18n key as-is — sufficient for testing component structure.

const React = require('react');

module.exports = {
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ i18nKey, children }) => i18nKey || children || null,
  I18nextProvider: ({ children }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
};
