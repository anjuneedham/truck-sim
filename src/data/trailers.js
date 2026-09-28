// Trailer catalogue (fictional operators). Dimensions in metres, mass in kg
// (arcade-scaled like the trucks so loaded rigs stay fun to drive).
//
//   length        body length
//   kingpin       distance of the kingpin behind the trailer's front face
//   kingpinToAxle distance from kingpin back to the tandem-axle centre
//   emptyMass     trailer without cargo
//   drag          extra aerodynamic drag coefficient (added to the truck's)

export const TRAILER_TYPES = {
  box: {
    id: 'box',
    name: 'Box trailer',
    operator: 'Northway Freight',
    length: 11.0,
    width: 2.55,
    height: 4.0,
    kingpin: 1.1,
    kingpinToAxle: 7.6,
    emptyMass: 3000,
    drag: 1.2,
    color: 0xf2f2ee,
    accent: 0x1d5fa8,
  },
  reefer: {
    id: 'reefer',
    name: 'Refrigerated trailer',
    operator: 'Polar Cold Chain',
    length: 11.0,
    width: 2.55,
    height: 4.0,
    kingpin: 1.1,
    kingpinToAxle: 7.6,
    emptyMass: 3600,
    drag: 1.3,
    color: 0xf7f9fb,
    accent: 0x3bb4e6,
  },
  flatbed: {
    id: 'flatbed',
    name: 'Flatbed',
    operator: 'Summit Steel',
    length: 11.0,
    width: 2.5,
    height: 1.4,
    kingpin: 1.1,
    kingpinToAxle: 7.8,
    emptyMass: 2400,
    drag: 0.8,
    color: 0x3b3f45,
    accent: 0xc0392b,
  },
  tanker: {
    id: 'tanker',
    name: 'Tanker',
    operator: 'Apex Fuels',
    length: 10.0,
    width: 2.5,
    height: 3.4,
    kingpin: 1.0,
    kingpinToAxle: 6.9,
    emptyMass: 2800,
    drag: 0.9,
    color: 0xd9dde2,
    accent: 0xf08a24,
  },
  container: {
    id: 'container',
    name: 'Container chassis',
    operator: 'Harbor Lines',
    length: 10.4,
    width: 2.5,
    height: 3.9,
    kingpin: 1.0,
    kingpinToAxle: 7.2,
    emptyMass: 2600,
    drag: 1.1,
    color: 0x8a2d2d, // container colour
    accent: 0x2f3338,
  },
};

export function getTrailerType(id) {
  return TRAILER_TYPES[id] || TRAILER_TYPES.box;
}
