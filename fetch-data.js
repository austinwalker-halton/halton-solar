const fs = require('fs');
const crypto = require('crypto');

const API_KEY = process.env.FOX_API_KEY;
const BASE_URL = 'https://www.foxesscloud.com';

function getSignature(path, timestamp) {
  const text = `${path}\\r\\n${API_KEY}\\r\\n${timestamp}`;
  return crypto.createHash('md5').update(text).digest('hex');
}

async function foxRequest(path, body = {}) {
  const timestamp = Date.now().toString();
  const signature = getSignature(path, timestamp);

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': API_KEY,
      'timestamp': timestamp,
      'signature': signature,
      'lang': 'en'
    },
    body: JSON.stringify(body)
  });

  return await res.json();
}

async function run() {
  try {
    // Query devices directly
    const deviceRes = await foxRequest('/op/v0/device/list', { currentPage: 1, pageSize: 10 });
    console.log('Device List:', JSON.stringify(deviceRes));

    const devices = deviceRes?.result?.data || [];
    const sns = devices.length > 0 
      ? devices.map(d => d.deviceSN) 
      : ['608M4240547F116', '608M4240547F081'];

    let totalPower = 0;
    let totalTodayGeneration = 0;
    let totalCumulate = 0;

    for (const sn of sns) {
      // 1. Instantaneous power
      const realRes = await foxRequest('/op/v0/device/real/query', {
        sn: sn,
        variables: ['pvPower', 'generationToday', 'cumulate']
      });
      console.log(`Real Query for ${sn}:`, JSON.stringify(realRes));

      const datas = realRes?.result?.[0]?.datas || [];
      for (const item of datas) {
        if (item.variable === 'pvPower') totalPower += Number(item.value || 0);
        if (item.variable === 'generationToday') totalTodayGeneration += Number(item.value || 0);
        if (item.variable === 'cumulate') totalCumulate += Number(item.value || 0);
      }

      // 2. Generation summary fallback if cumulate is in report endpoint
      const genRes = await foxRequest('/op/v0/device/generation', { sn: sn });
      console.log(`Gen Query for ${sn}:`, JSON.stringify(genRes));
      if (genRes?.result) {
        if (genRes.result.today && totalTodayGeneration === 0) {
          totalTodayGeneration += Number(genRes.result.today || 0);
        }
        if (genRes.result.cumulate) {
          totalCumulate += Number(genRes.result.cumulate || 0);
        }
      }
    }

    // Environmental metrics matching Fox ESS constants (~1.0 kg/kWh and ~1.003 trees/kg)
    const co2Kg = Math.round(totalCumulate * 0.997);
    const trees = Math.round(co2Kg * 1.003);

    const output = {
      currentKw: Number(totalPower.toFixed(1)),
      todayKwh: Number(totalTodayGeneration.toFixed(2)),
      lifetimeKwh: Math.round(totalCumulate),
      co2ReductionKg: co2Kg,
      treesPlanted: trees,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    console.log('Resulting data.json:', output);
  } catch (err) {
    console.error('Fatal fetch error:', err);
    process.exit(1);
  }
}

run();
