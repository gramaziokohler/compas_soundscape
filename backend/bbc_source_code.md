const appUrls = {
  local: {
    client: 'http://local.bbc.co.uk:3000',
    api: 'http://localhost:3001/dev',
    batchDownload: 'ws://localhost:4001'
  },
  development: {
    client: 'http://local.bbc.co.uk:3000',
    api: 'https://sound-effects-api-dev.bbcrewind.co.uk',
    batchDownload: 'wss://kypd0uek3b.execute-api.eu-west-1.amazonaws.com/dev',
  },
  staging: {
    client: 'https://sound-effects-staging.bbcrewind.co.uk',
    api: 'https://sound-effects-api-staging.bbcrewind.co.uk',
    batchDownload: 'wss://169kaitchf.execute-api.eu-west-1.amazonaws.com/staging',
  },
  production: {
    client: 'https://sound-effects.bbcrewind.co.uk',
    api: 'https://sound-effects-api.bbcrewind.co.uk',
    batchDownload: 'wss://9qykiiihp2.execute-api.eu-west-1.amazonaws.com/prod',
  }
};

export const VERSION = packageJson.version;
export const ENVIRONMENT = process.env.REACT_APP_APP_ENV || 'development';

export const APP_URL = appUrls[ENVIRONMENT].client;
export const API_URL = appUrls[ENVIRONMENT].api;
export const BATCH_DOWNLOAD_FUNCTION = appUrls[ENVIRONMENT].batchDownload;
export const MEDIA_BASE_URL = ENVIRONMENT === 'production' ? 'https://sound-effects-media.bbcrewind.co.uk' : 'https://sound-effects-media-staging.bbcrewind.co.uk'; // Use staging CDN unless prod
export const MEDIA_LOW_QUALITY_URL = `${MEDIA_BASE_URL}/mp3`;
export const MEDIA_HIGH_QUALITY_URL = `${MEDIA_BASE_URL}/zip`;
export const WAVEFORM_URL = `${MEDIA_BASE_URL}/waveform`;


