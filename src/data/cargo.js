// Cargo catalogue. `trailer` picks the trailer type for tractor jobs; rigid
// box trucks can only take 'box' cargo up to their payload limit.
//
//   mass     [min, max] kg (arcade-scaled)
//   value    pay multiplier (high-value goods pay more)
//   fragile  damage penalty multiplier (fragile/hazardous goods lose more pay)
//   rush     time bonus multiplier (perishables reward fast delivery)

export const CARGO = {
  canned: { id: 'canned', name: 'Canned goods', trailer: 'box', mass: [3000, 5000], value: 1.0, fragile: 1.0, rush: 1.0 },
  electronics: { id: 'electronics', name: 'Electronics', trailer: 'box', mass: [1500, 3000], value: 1.5, fragile: 1.8, rush: 1.0 },
  furniture: { id: 'furniture', name: 'Furniture', trailer: 'box', mass: [2000, 4000], value: 1.1, fragile: 1.3, rush: 1.0 },
  consumer: { id: 'consumer', name: 'Consumer goods', trailer: 'container', mass: [3000, 6000], value: 1.15, fragile: 1.0, rush: 1.0 },
  autoparts: { id: 'autoparts', name: 'Auto parts', trailer: 'container', mass: [3000, 5500], value: 1.2, fragile: 1.1, rush: 1.0 },
  produce: { id: 'produce', name: 'Fresh produce', trailer: 'reefer', mass: [2500, 4500], value: 1.2, fragile: 1.0, rush: 1.6 },
  frozen: { id: 'frozen', name: 'Frozen food', trailer: 'reefer', mass: [3000, 5000], value: 1.3, fragile: 1.0, rush: 1.4 },
  dairy: { id: 'dairy', name: 'Dairy', trailer: 'reefer', mass: [2500, 4500], value: 1.2, fragile: 1.1, rush: 1.5 },
  steel: { id: 'steel', name: 'Steel beams', trailer: 'flatbed', mass: [5000, 8000], value: 1.2, fragile: 0.6, rush: 1.0 },
  lumber: { id: 'lumber', name: 'Lumber', trailer: 'flatbed', mass: [3500, 6000], value: 1.0, fragile: 0.7, rush: 1.0 },
  machinery: { id: 'machinery', name: 'Machinery', trailer: 'flatbed', mass: [5000, 8000], value: 1.45, fragile: 1.4, rush: 1.0 },
  fuel: { id: 'fuel', name: 'Diesel fuel', trailer: 'tanker', mass: [5000, 7500], value: 1.4, fragile: 1.6, rush: 1.0 },
  cookingoil: { id: 'cookingoil', name: 'Cooking oil', trailer: 'tanker', mass: [4000, 6500], value: 1.1, fragile: 1.0, rush: 1.0 },
};

export function getCargo(id) {
  return CARGO[id] || CARGO.canned;
}
