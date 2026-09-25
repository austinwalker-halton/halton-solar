const fs = require('fs');
const crypto = require('crypto');

const API_KEY = process.env.FOX_API_KEY;
const BASE_URL = 'https://www.foxesscloud.com';

function getSignature(path, timestamp) {
  const text = `${path}\r\n${API_KEY}\r\n${timestamp}`;
  return crypto.createHash('md5').update(text).digest('hex');
}

async function foxRequest(path, params = {}, method = 'POST') {
  const timestamp = Date.now().toString();
  const signature = getSignature(path, timestamp);

  const headers = {
    'token': API_KEY,
    'timestamp': timestamp,
    'signature': signature,
    'lang': 'en'
  };

  let url = `${BASE_URL}${path}`;
  const options = { method, headers };

  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(params);
  } else if (method === 'GET' && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(params).toString();
    url = `${url}?${qs}`;
  }

  const res = await fetch(url, options);
  return await res.json();
}

async function run() {
  try {
    // 1. Get Device List
    const deviceRes = await foxRequest('/op/v0/device/list', { currentPage: 1, pageSize: 10 });
    const devices = deviceRes?.result?.data || [];
    
    if (devices.length === 0) {
      throw new Error('No devices returned from Fox ESS.');
    }

    let totalPower = 0;
    let totalTodayGeneration = 0;
    let totalCumulate = 0;

    for (const dev of devices) {
      const sn = dev.deviceSN;

      // Realtime instantaneous PV Power
      const realRes = await foxRequest('/op/v0/device/real/query', {
        sn: sn,
        variables: ['pvPower']
      }, 'POST');

      const datas = realRes?.result?.[0]?.datas || [];
      const pvItem = datas.find(d => d.variable === 'pvPower');
      if (pvItem) {
        totalPower += Number(pvItem.value || 0);
      }

      // Generation totals (Requires GET query with sn)
      const genRes = await foxRequest('/op/v0/device/generation', { sn: sn }, 'GET');
      console.log(`Gen Result for ${sn}:`, JSON.stringify(genRes));

      if (genRes?.result) {
        totalTodayGeneration += Number(genRes.result.today || 0);
        totalCumulate += Number(genRes.result.cumulative || genRes.result.cumulate || 0);
      }
    }

    // Fox ESS environmental conversions: ~0.997 for CO2 and ~1.003 for Trees
    const co2Kg = Math.round(totalCumulate * 0.997);
    const trees = Math.round(totalCumulate * 1.003);

    const output = {
      currentKw: Number(totalPower.toFixed(1)),
      todayKwh: Number(totalTodayGeneration.toFixed(2)),
      lifetimeKwh: Math.round(totalCumulate),
      co2ReductionKg: co2Kg,
      treesPlanted: trees,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    console.log('Updated data.json successfully:', output);
  } catch (err) {
    console.error('Fatal fetch error:', err);
    process.exit(1);
  }
}

run();
