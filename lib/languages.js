'use strict';

/** Languages the reader understands on a page. `tag` is used for browser speech and the HTML lang attribute. */
const LANGUAGES = [
  { code: 'te', name: 'Telugu', tag: 'te-IN' },
  { code: 'hi', name: 'Hindi', tag: 'hi-IN' },
  { code: 'ta', name: 'Tamil', tag: 'ta-IN' },
  { code: 'kn', name: 'Kannada', tag: 'kn-IN' },
  { code: 'ml', name: 'Malayalam', tag: 'ml-IN' },
  { code: 'mr', name: 'Marathi', tag: 'mr-IN' },
  { code: 'bn', name: 'Bengali', tag: 'bn-IN' },
  { code: 'gu', name: 'Gujarati', tag: 'gu-IN' },
  { code: 'pa', name: 'Punjabi', tag: 'pa-IN' },
  { code: 'or', name: 'Odia', tag: 'or-IN' },
  { code: 'ur', name: 'Urdu', tag: 'ur-IN' },
  { code: 'en', name: 'English', tag: 'en-IN' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

function languageFor(code) {
  return BY_CODE.get(code) || null;
}

module.exports = { LANGUAGES, languageFor };
