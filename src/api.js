import axios from 'axios'


const base_url = 'https://www.okx.com'


export async function marketCandles(instId, bar, after, before, limit){
  const {data} = await axios.get(base_url+'/api/v5/market/candles', {
    params:{
      instId,bar, after, before, limit
    },
  })
  return data;
}

export async function marketCandlesHistory(instId,bar, after, before, limit){
  return axios.get(base_url+'/api/v5/market/history-candles', {
    params:{
      instId,bar, after, before, limit
    },
  })
}


// 登录函数
export async function doLogin(ctx){

  // 准备登录请求
  const timestamp = Math.round(Date.now()/1000);
  const method = 'GET';
  const requestPath = '/users/self/verify';
  const body = ''; // WebSocket登录请求没有body
  const sign = generateSignature(timestamp, method, requestPath, body, api_secret);
  await ctx.send(JSON.stringify({
    "op": "login",
    "args":
     [
        {
          apiKey: api_key,
          passphrase: pass_phrase,
          timestamp,
          sign
         }
      ]
   }))
}


export async function subscribeKlineChanel(ws, channel, instId){
  ws.send(JSON.stringify({
    "op":"subscribe",
    "args":[
      {
          "channel":channel,
          "instId": instId
      }
    ]
  }))
}
