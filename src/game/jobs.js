// Job generation + reward maths. Pure functions over the data files so the
// job market, mission and tests all agree on distances and pay.

import { FACILITIES, getFacility } from './mapData.js';
import { getCargo } from '../data/cargo.js';
import { ECONOMY } from '../data/economy.js';

const E = ECONOMY;

/** Estimated road distance (km) between two facilities' pickup and drop-off. */
export function routeKm(fromId, toId) {
  const a = getFacility(fromId).trailerSpot;
  const b = getFacility(toId).dropZone;
  const manhattan = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  return Math.max(E.jobs.minKm, (manhattan * E.jobs.routeFactor) / 1000);
}

/** 1..3 stars from cargo weight, fragility and how tight the drop-off is. */
export function jobDifficulty(cargo, mass, toId) {
  const score = mass / 8000 + (cargo.fragile - 1) * 0.6 + getFacility(toId).difficulty;
  return score > 1.15 ? 3 : score > 0.75 ? 2 : 1;
}

/** Can this truck take the job? Rigid box trucks: box cargo within payload. */
export function jobCompatible(job, truckEntry) {
  if (truckEntry.body === 'tractor') return true;
  return getCargo(job.cargo).trailer === 'box' && job.mass <= E.jobs.rigidPayload;
}

/** Pay before bonuses/penalties. */
export function jobPay(job, withTrailer) {
  const cargo = getCargo(job.cargo);
  const D = E.delivery;
  let pay = (D.basePay + job.km * D.payPerKm) * cargo.value * D.difficultyMultiplier[job.difficulty - 1];
  if (withTrailer) pay *= D.trailerMultiplier;
  return Math.round(pay / 10) * 10;
}

/** Build a job object. `rng` returns 0..1. */
export function makeJob(cargoId, fromId, toId, rng = Math.random, id = null) {
  const cargo = getCargo(cargoId);
  const mass = Math.round((cargo.mass[0] + rng() * (cargo.mass[1] - cargo.mass[0])) / 100) * 100;
  const km = routeKm(fromId, toId);
  return {
    id: id || `${cargoId}-${fromId}-${toId}-${Math.floor(rng() * 1e6)}`,
    cargo: cargoId,
    from: fromId,
    to: toId,
    mass,
    km,
    difficulty: jobDifficulty(cargo, mass, toId),
  };
}

/**
 * A fresh job market. Guarantees jobs from the player's current location and
 * at least one job the current truck can do.
 */
export function generateJobs(currentFacilityId, truckEntry, rng = Math.random) {
  const jobs = [];
  const count = E.jobs.marketSize;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const here = getFacility(currentFacilityId);
  const exists = (cargoId, from, to) => jobs.some((j) => j.cargo === cargoId && j.from === from && j.to === to);

  // Every distinct (cargo, from, to) route the map supports.
  const routes = [];
  for (const from of FACILITIES) {
    for (const cargoId of from.produces) {
      for (const to of FACILITIES) {
        if (to.id !== from.id && to.accepts.includes(cargoId)) routes.push({ cargoId, from: from.id, to: to.id });
      }
    }
  }
  const local = routes.filter((r) => r.from === here.id);
  const add = (r) => {
    if (!r || exists(r.cargoId, r.from, r.to)) return false;
    jobs.push(makeJob(r.cargoId, r.from, r.to, rng));
    return true;
  };

  // About half the jobs start where the player is (as many as the facility allows).
  let tries = 0;
  while (jobs.length < Math.ceil(count / 2) && tries++ < 30) add(pick(local));
  // The rest from anywhere.
  tries = 0;
  while (jobs.length < count && tries++ < 200) add(pick(routes));

  // Make sure a rigid box truck always has something to do.
  if (!jobs.some((j) => jobCompatible(j, truckEntry))) {
    // Prefer lightening an existing box-cargo job over adding a near-duplicate.
    const boxJob = jobs.find((j) => getCargo(j.cargo).trailer === 'box');
    if (boxJob) {
      boxJob.mass = Math.min(boxJob.mass, E.jobs.rigidPayload);
    } else {
      const boxRoutes = routes.filter((r) => getCargo(r.cargoId).trailer === 'box');
      const r = boxRoutes.find((x) => x.from === here.id) || pick(boxRoutes);
      const job = makeJob(r.cargoId, r.from, r.to, rng);
      job.mass = Math.min(job.mass, E.jobs.rigidPayload);
      jobs[jobs.length - 1] = job;
    }
  }
  return jobs;
}

/**
 * Final reward for a finished delivery.
 * @param {object} job
 * @param {{withTrailer:boolean, time:number, damagePct:number}} r
 */
export function computeReward(job, { withTrailer, time, damagePct }) {
  const D = E.delivery;
  const cargo = getCargo(job.cargo);
  const basePay = jobPay(job, withTrailer);
  const parTime = parTimeFor(job, withTrailer);
  const timeBonus =
    time < parTime ? Math.round(basePay * D.timeBonusFraction * cargo.rush * ((parTime - time) / parTime)) : 0;
  const damagePenalty = Math.min(basePay, Math.round((basePay * damagePct * D.damagePenaltyPerPct * cargo.fragile) / 100));
  const total = Math.max(0, basePay - damagePenalty + timeBonus);
  return { basePay, timeBonus, damagePenalty, damagePct, total, time, parTime };
}

export function parTimeFor(job, withTrailer) {
  const D = E.delivery;
  return (job.km / (withTrailer ? D.parSpeedTrailerKmh : D.parSpeedKmh)) * 3600;
}
