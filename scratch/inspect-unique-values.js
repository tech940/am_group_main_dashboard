const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'next/cache') {
    return {
      unstable_cache: (fn) => {
        // Just return the inner function directly without caching
        return fn;
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

// Start the TSX runner and register paths
require('tsx/cjs/api');

// Now import the ts file dynamically
require('./inspect-unique-values.ts');
