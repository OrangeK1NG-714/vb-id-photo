const BASE_URLS = {
  develop: 'http://localhost:3000',
  trial: '',
  release: ''
};

function currentEnv() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion || 'develop';
  } catch (_) {
    return 'develop';
  }
}

function getBaseUrl() {
  const env = currentEnv();
  const baseUrl = BASE_URLS[env];
  if (!baseUrl) {
    const error = new Error(`${env} 环境尚未配置后端 HTTPS 域名`);
    error.code = 'ENV_NOT_CONFIGURED';
    throw error;
  }
  return baseUrl.replace(/\/$/, '');
}

module.exports = { BASE_URLS, currentEnv, getBaseUrl };
