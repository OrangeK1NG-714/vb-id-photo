const { getBaseUrl } = require('./config.js');

App({
  globalData: {
    sourceImagePath: '',
    resultData: null,
    configurationError: ''
  },

  onLaunch() {
    try {
      getBaseUrl();
    } catch (error) {
      this.globalData.configurationError = error.message;
    }
  }
});
