// utils/loadEnv.js
const fs = require('fs');
const path = require('path');

function loadEnv(envFilePath = '.env') {
  console.log(__dirname, envFilePath)
  const envPath = path.resolve(__dirname, '..', '..', envFilePath);
  if (!fs.existsSync(envPath)) return {}; // si no existe, retorna objeto vacío

  const envFile = fs.readFileSync(envPath, { encoding: 'utf-8' });
  const result = {};

  envFile.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return; 
    const [key, ...vals] = line.split('=');
    const value = vals.join('=').trim().replace(/^["']|["']$/g, '');
    process.env[key.trim()] = value; // asigna a process.env
    result[key.trim()] = value;      // guarda en objeto de retorno
  });

  return result;
}

module.exports = loadEnv;
