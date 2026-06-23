'use strict';

const path = require('path');

// Resolve from node_modules symlink/copy back to repo src/eslint-rules.
module.exports = require(
  path.join(__dirname, '..', '..', 'src', 'eslint-rules')
);
