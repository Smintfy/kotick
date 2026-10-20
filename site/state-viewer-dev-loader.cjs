module.exports = function stateViewerDevLoader(source) {
  return source.replaceAll('process.env.NODE_ENV', '"development"');
};
