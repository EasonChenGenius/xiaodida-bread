const config=require('./config');
App({onLaunch(){if(config.transport==='cloud'&&wx.cloud)wx.cloud.init({traceUser:false});}});
