const fs = require('fs');
const crypto = require('crypto');

const API_KEY = process.env.FOX_API_KEY;
const BASE_URL = 'https://www.foxesscloud.com';

function getSignature(path, timestamp) {
  const text = `${path}\r\n${API_KEY}\r\n${timestamp}`;
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
    // 1. Get plant list
    const plantListRes = await foxRequest('/op/v0/plant/list', { pageIndex: 1, pageSize: 10 });
    const plants = plantListRes?.result?.data || [];
    
    if (plants.length === 0) {
      throw new Error('No plants found on this Fox ESS account.');
    }

    const plant = plants[0];
    const plantId = plant.plantID;

    // 2. Fetch realtime power and daily production
    const realRes = await foxRequest('/op/v0/plant/getPlantReal', { plantID: plantId });
    const realData = realRes?.result || {};

    // 3. Fetch cumulative generation and environmental impact
    const totalRes = await foxRequest('/op/v0/plant/getPlantGeneration', { plantID: plantId });
    const totalData = totalRes?.result || {};

    const output = {
      currentKw: Number(realData.power || 0),
      todayKwh: Number(realData.todayGeneration || 0),
      lifetimeKwh: Number(totalData.cumulate || 0),
      co2ReductionKg: Number(totalData.trees || totalData.co2Reduction || Math.round((totalData.cumulate || 0) * 0.997)),
      treesPlanted: Number(totalData.treesPlanted || Math.round((totalData.cumulate || 0) * 1.0003)),
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
    console.log('Successfully updated data.json:', output);
  } catch (err) {
    console.error('Error fetching Fox ESS data:', err);
    process.exit(1);
  }
}

run();
