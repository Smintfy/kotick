module.exports = function konatDevLoader(source) {
  return source.replaceAll('process.env.NODE_ENV', '"development"');
};
