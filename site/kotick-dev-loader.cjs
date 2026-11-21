module.exports = function kotickDevLoader(source) {
  return source.replaceAll('process.env.NODE_ENV', '"development"');
};
