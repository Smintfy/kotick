module.exports = function shiruDevLoader(source) {
  return source.replaceAll('process.env.NODE_ENV', '"development"');
};
