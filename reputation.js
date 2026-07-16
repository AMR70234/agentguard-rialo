const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'reputation.json');

function loadReputation() {
  try {
    const data = fs.readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return { totalJobs: 0, accepted: 0, rejected: 0 };
  }
}

function saveReputation(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

function recordJob(accepted) {
  const rep = loadReputation();
  rep.totalJobs += 1;
  if (accepted) rep.accepted += 1;
  else rep.rejected += 1;
  saveReputation(rep);
  return getStats();
}

function getStats() {
  const rep = loadReputation();
  const acceptanceRate = rep.totalJobs > 0
    ? Math.round((rep.accepted / rep.totalJobs) * 100)
    : 100;
  return { ...rep, acceptanceRate };
}

module.exports = { recordJob, getStats };
