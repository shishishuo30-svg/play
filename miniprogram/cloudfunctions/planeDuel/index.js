'use strict';
const cloud = require('wx-server-sdk');
const { createHandler } = require('./service');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const handler = createHandler({
  async transaction(code, operation) {
    return db.runTransaction(async transaction => {
      const document = transaction.collection('plane_duel_rooms').doc(code);
      let room = null;
      try { room = (await document.get()).data; }
      catch (error) {
        const message = `${error.errMsg || ''} ${error.message || ''}`;
        if (!/document[^\n]*(not exist|not found)/i.test(message)) throw error;
      }
      const result = await operation(room);
      if (result.save) await document.set({ data: result.save });
      return result.response;
    });
  }
});
exports.main = async event => handler(event, cloud.getWXContext().OPENID);
