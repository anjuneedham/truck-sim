// All money values in one place. Gameplay code reads these instead of
// hard-coding numbers, so balancing is a data change.

export const ECONOMY = {
  startingMoney: 1500,

  delivery: {
    basePay: 200, // flat amount per job
    payPerKm: 1100, // per km of estimated route (pickup -> drop-off)
    trailerMultiplier: 1.35, // semi-trailer jobs pay more than rigid-truck jobs
    difficultyMultiplier: [1.0, 1.15, 1.3], // 1..3 stars
    timeBonusFraction: 0.25, // max time bonus as a fraction of the job pay
    damagePenaltyPerPct: 1.0, // % of pay lost per % of damage (x cargo fragility)
    abandonFee: 150, // charged when a job is abandoned or failed
    parSpeedKmh: 35, // average speed that earns zero time bonus (rigid truck)
    parSpeedTrailerKmh: 24, // same for semi-trailer jobs
  },

  jobs: {
    marketSize: 6, // jobs offered at once
    minKm: 0.25, // shortest job distance used for pay
    routeFactor: 1.15, // Manhattan distance x factor ~ road distance on this grid map
    rigidPayload: 4000, // kg a rigid box truck can carry
  },
};
