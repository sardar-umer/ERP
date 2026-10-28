export const activeAmount = (entry) => {
  if (entry == null) return 0;
  if (typeof entry === 'number') return entry > 0 ? entry : 0;
  return entry.isActive ? Number(entry.amount) || 0 : 0;
};

const hasVehicleOrFuel = (allowances) => {
  const a = allowances || {};
  return !!(a.vehicle?.isActive || a.fuel?.isActive);
};

const usesSplitVehicleFuelFields = (allowances) => {
  const a = allowances || {};
  return a.vehicle != null || a.fuel != null || hasVehicleOrFuel(a);
};

export const vehicleFuelTotal = (allowances) => {
  const a = allowances || {};
  if (usesSplitVehicleFuelFields(a)) {
    return activeAmount(a.vehicle) + activeAmount(a.fuel);
  }
  return activeAmount(a.vehicleFuel);
};

export const vehicleAllowanceAmount = (allowances) => {
  const a = allowances || {};
  if (a.vehicle) return activeAmount(a.vehicle);
  if (!usesSplitVehicleFuelFields(a) && a.vehicleFuel?.isActive) return activeAmount(a.vehicleFuel);
  return 0;
};

export const fuelAllowanceAmount = (allowances) => activeAmount((allowances || {}).fuel);

/** Map stored allowances to form state (legacy vehicleFuel → vehicle). */
export const allowancesForForm = (allowances = {}) => {
  const hasNew = allowances.vehicle?.isActive || allowances.fuel?.isActive;
  const vehicle = allowances.vehicle || { isActive: false, amount: 0 };
  const fuel = allowances.fuel || { isActive: false, amount: 0 };
  if (!hasNew && allowances.vehicleFuel?.isActive) {
    return {
      ...allowances,
      vehicle: { isActive: true, amount: allowances.vehicleFuel.amount || 0 },
      fuel: { isActive: false, amount: 0 }
    };
  }
  return { ...allowances, vehicle, fuel };
};

/** Normalize allowances for save (clears legacy combined vehicleFuel). */
export const buildAllowancesPayload = (src) => {
  if (!src || typeof src !== 'object') return defaultAllowanceFields();
  const parse = (e) => ({
    isActive: !!e?.isActive,
    amount: parseFloat(e?.amount) || 0
  });
  return {
    conveyance: parse(src.conveyance),
    food: parse(src.food),
    mobile: parse(src.mobile),
    vehicle: parse(src.vehicle),
    fuel: parse(src.fuel),
    vehicleFuel: { isActive: false, amount: 0 },
    medical: parse(src.medical),
    houseRent: parse(src.houseRent),
    special: parse(src.special),
    other: parse(src.other)
  };
};

export const defaultAllowanceFields = () => ({
  conveyance: { isActive: false, amount: 0 },
  food: { isActive: false, amount: 0 },
  mobile: { isActive: false, amount: 0 },
  vehicle: { isActive: false, amount: 0 },
  fuel: { isActive: false, amount: 0 },
  medical: { isActive: false, amount: 0 },
  houseRent: { isActive: false, amount: 0 },
  special: { isActive: false, amount: 0 },
  other: { isActive: false, amount: 0 }
});
