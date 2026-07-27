export const TRAFFIC_VEHICLE_KINDS = [
	'motorcycle',
	'compact',
	'civic',
	'suv',
	'pickup',
	'van',
	'truck',
	'bus',
	'supercar',
] as const;

export type TrafficVehicleKind = (typeof TRAFFIC_VEHICLE_KINDS)[number];

export interface TrafficVehicleModel {
	readonly id: string;
	readonly kind: TrafficVehicleKind;
	readonly label: string;
	readonly lengthMeters: number;
	readonly widthMeters: number;
	readonly heightMeters: number;
	readonly wheelbaseMeters: number;
	readonly wheelRadiusMeters: number;
	readonly wheelCount: 2 | 4 | 6;
	/** Solver-relative mass. One equals one metric tonne. */
	readonly massTons: number;
	readonly topSpeedKph: number;
	readonly zeroTo100Seconds: number;
	/** Dense city road governor. Full top speed remains physics metadata. */
	readonly roadCruiseKph: readonly [number, number];
	readonly traction: number;
	readonly turnResponse: number;
	readonly bodyColor: number;
	readonly accentColor: number;
	readonly spawnWeight: number;
}

const trafficModels: readonly TrafficVehicleModel[] = [
	{
		id: 'motorcycle', kind: 'motorcycle', label: 'Sport motorcycle',
		lengthMeters: 2.07, widthMeters: 0.85, heightMeters: 1.17,
		wheelbaseMeters: 1.46, wheelRadiusMeters: 0.31, wheelCount: 2,
		massTons: 0.192, topSpeedKph: 314, zeroTo100Seconds: 3.1,
		roadCruiseKph: [55, 90], traction: 0.94, turnResponse: 1.3,
		bodyColor: 0xd34f3f, accentColor: 0xf3c755, spawnWeight: 6,
	},
	{
		id: 'honda-civic', kind: 'civic', label: 'Honda Civic',
		lengthMeters: 4.25, widthMeters: 1.76, heightMeters: 1.46,
		wheelbaseMeters: 2.64, wheelRadiusMeters: 0.31, wheelCount: 4,
		massTons: 1.25, topSpeedKph: 207, zeroTo100Seconds: 8.6,
		roadCruiseKph: [40, 72], traction: 0.88, turnResponse: 0.98,
		bodyColor: 0x6392b6, accentColor: 0xa7d3e1, spawnWeight: 4,
	},
	{
		id: 'mclaren-gts', kind: 'supercar', label: 'McLaren GTS',
		lengthMeters: 4.68, widthMeters: 2.1, heightMeters: 1.21,
		wheelbaseMeters: 2.67, wheelRadiusMeters: 0.35, wheelCount: 4,
		massTons: 1.52, topSpeedKph: 326, zeroTo100Seconds: 3.2,
		roadCruiseKph: [60, 100], traction: 1.13, turnResponse: 1.22,
		bodyColor: 0xd95143, accentColor: 0xffc46d, spawnWeight: 1,
	},
	{
		id: 'chevy-traverse', kind: 'suv', label: 'Chevrolet Traverse',
		lengthMeters: 5.19, widthMeters: 1.99, heightMeters: 1.79,
		wheelbaseMeters: 3.07, wheelRadiusMeters: 0.38, wheelCount: 4,
		massTons: 2.05, topSpeedKph: 180, zeroTo100Seconds: 7.1,
		roadCruiseKph: [38, 65], traction: 0.84, turnResponse: 0.76,
		bodyColor: 0x587563, accentColor: 0xc2d6c3, spawnWeight: 3,
	},
	{
		id: 'toyota-alphard', kind: 'van', label: 'Toyota Alphard',
		lengthMeters: 4.95, widthMeters: 1.85, heightMeters: 1.94,
		wheelbaseMeters: 3, wheelRadiusMeters: 0.36, wheelCount: 4,
		massTons: 2.08, topSpeedKph: 180, zeroTo100Seconds: 8.5,
		roadCruiseKph: [35, 58], traction: 0.78, turnResponse: 0.69,
		bodyColor: 0xd6d5ca, accentColor: 0xa7b0ad, spawnWeight: 3,
	},
	{
		id: 'civic-police', kind: 'civic', label: 'Civic police car',
		lengthMeters: 4.25, widthMeters: 1.76, heightMeters: 1.46,
		wheelbaseMeters: 2.64, wheelRadiusMeters: 0.31, wheelCount: 4,
		massTons: 1.31, topSpeedKph: 207, zeroTo100Seconds: 8.6,
		roadCruiseKph: [45, 76], traction: 0.9, turnResponse: 1,
		bodyColor: 0x476b93, accentColor: 0xe6ebed, spawnWeight: 2,
	},
	{
		id: 'daihatsu-xenia', kind: 'compact', label: 'Daihatsu Xenia',
		lengthMeters: 4.19, widthMeters: 1.66, heightMeters: 1.7,
		wheelbaseMeters: 2.66, wheelRadiusMeters: 0.3, wheelCount: 4,
		massTons: 1.23, topSpeedKph: 180, zeroTo100Seconds: 12.2,
		roadCruiseKph: [36, 62], traction: 0.82, turnResponse: 0.86,
		bodyColor: 0x76a5b6, accentColor: 0xc9e5e5, spawnWeight: 4,
	},
	{
		id: 'wuling-ev', kind: 'compact', label: 'Wuling EV',
		lengthMeters: 2.92, widthMeters: 1.49, heightMeters: 1.62,
		wheelbaseMeters: 1.94, wheelRadiusMeters: 0.27, wheelCount: 4,
		massTons: 1.05, topSpeedKph: 120, zeroTo100Seconds: 13.5,
		roadCruiseKph: [30, 52], traction: 0.8, turnResponse: 1.05,
		bodyColor: 0x9bd1ce, accentColor: 0xe4f0e8, spawnWeight: 3,
	},
	{
		id: 'pickup', kind: 'pickup', label: 'Pickup',
		lengthMeters: 5.46, widthMeters: 1.97, heightMeters: 1.93,
		wheelbaseMeters: 3.26, wheelRadiusMeters: 0.4, wheelCount: 4,
		massTons: 2.71, topSpeedKph: 180, zeroTo100Seconds: 5.7,
		roadCruiseKph: [35, 65], traction: 0.87, turnResponse: 0.7,
		bodyColor: 0xe8c178, accentColor: 0x6f786e, spawnWeight: 3,
	},
	{
		id: 'wuling-ev-blue', kind: 'compact', label: 'Wuling EV blue',
		lengthMeters: 2.92, widthMeters: 1.49, heightMeters: 1.62,
		wheelbaseMeters: 1.94, wheelRadiusMeters: 0.27, wheelCount: 4,
		massTons: 1.05, topSpeedKph: 120, zeroTo100Seconds: 13.5,
		roadCruiseKph: [30, 52], traction: 0.8, turnResponse: 1.05,
		bodyColor: 0x497cae, accentColor: 0xb8dae8, spawnWeight: 3,
	},
	{
		id: 'box-van', kind: 'van', label: 'Box van',
		lengthMeters: 4.8, widthMeters: 1.9, heightMeters: 2.05,
		wheelbaseMeters: 2.9, wheelRadiusMeters: 0.36, wheelCount: 4,
		massTons: 1.7, topSpeedKph: 173, zeroTo100Seconds: 12.3,
		roadCruiseKph: [32, 58], traction: 0.76, turnResponse: 0.7,
		bodyColor: 0xe7ded0, accentColor: 0xa2aaa5, spawnWeight: 3,
	},
	{
		id: 'suzuki-carry', kind: 'van', label: 'Suzuki Carry',
		lengthMeters: 4.2, widthMeters: 1.77, heightMeters: 1.91,
		wheelbaseMeters: 2.2, wheelRadiusMeters: 0.31, wheelCount: 4,
		massTons: 1.1, topSpeedKph: 135, zeroTo100Seconds: 15,
		roadCruiseKph: [28, 48], traction: 0.72, turnResponse: 0.78,
		bodyColor: 0xf1d68c, accentColor: 0x8fa2a4, spawnWeight: 3,
	},
	{
		id: 'toyota-fortuner', kind: 'suv', label: 'Toyota Fortuner',
		lengthMeters: 4.8, widthMeters: 1.86, heightMeters: 1.84,
		wheelbaseMeters: 2.75, wheelRadiusMeters: 0.38, wheelCount: 4,
		massTons: 2.05, topSpeedKph: 180, zeroTo100Seconds: 10.8,
		roadCruiseKph: [36, 62], traction: 0.83, turnResponse: 0.76,
		bodyColor: 0x527360, accentColor: 0xc4d8c2, spawnWeight: 3,
	},
	{
		id: 'ambulance', kind: 'van', label: 'Ambulance',
		lengthMeters: 5.3, widthMeters: 2, heightMeters: 2.35,
		wheelbaseMeters: 3.2, wheelRadiusMeters: 0.38, wheelCount: 4,
		massTons: 2.6, topSpeedKph: 160, zeroTo100Seconds: 13,
		roadCruiseKph: [38, 68], traction: 0.78, turnResponse: 0.72,
		bodyColor: 0xecdfcb, accentColor: 0xc85d4f, spawnWeight: 1,
	},
	{
		id: 'toyota-innova', kind: 'suv', label: 'Toyota Innova',
		lengthMeters: 4.74, widthMeters: 1.83, heightMeters: 1.8,
		wheelbaseMeters: 2.75, wheelRadiusMeters: 0.36, wheelCount: 4,
		massTons: 1.83, topSpeedKph: 170, zeroTo100Seconds: 12.5,
		roadCruiseKph: [35, 60], traction: 0.8, turnResponse: 0.78,
		bodyColor: 0x9cac89, accentColor: 0xe1dcc8, spawnWeight: 3,
	},
	{
		id: 'isuzu-trooper', kind: 'suv', label: 'Isuzu Trooper',
		lengthMeters: 4.66, widthMeters: 1.84, heightMeters: 1.84,
		wheelbaseMeters: 2.76, wheelRadiusMeters: 0.37, wheelCount: 4,
		massTons: 1.95, topSpeedKph: 170, zeroTo100Seconds: 12.8,
		roadCruiseKph: [34, 58], traction: 0.79, turnResponse: 0.74,
		bodyColor: 0x6d735f, accentColor: 0xc5c9bc, spawnWeight: 2,
	},
	{
		id: 'civic-civilian', kind: 'civic', label: 'Civic civilian',
		lengthMeters: 4.25, widthMeters: 1.76, heightMeters: 1.46,
		wheelbaseMeters: 2.64, wheelRadiusMeters: 0.31, wheelCount: 4,
		massTons: 1.25, topSpeedKph: 207, zeroTo100Seconds: 8.6,
		roadCruiseKph: [40, 72], traction: 0.88, turnResponse: 0.98,
		bodyColor: 0xc76850, accentColor: 0xf0d0bc, spawnWeight: 4,
	},
	...Array.from({ length: 5 }, (_, index): TrafficVehicleModel => ({
		id: `cargo-truck-${index + 1}`, kind: 'truck', label: `Cargo truck ${index + 1}`,
		lengthMeters: 8.2, widthMeters: 2.5, heightMeters: 3.45,
		wheelbaseMeters: 4.7, wheelRadiusMeters: 0.47, wheelCount: 6,
		massTons: 18 + index * 1.5, topSpeedKph: 100, zeroTo100Seconds: 38,
		roadCruiseKph: [25, 45], traction: 0.7, turnResponse: 0.48,
		bodyColor: [0xc87535, 0xd78c45, 0x497a94, 0x7f9163, 0xa85645][index],
		accentColor: 0xe0d1ae, spawnWeight: 2,
	})),
	...Array.from({ length: 5 }, (_, index): TrafficVehicleModel => ({
		id: `city-truck-${index + 1}`, kind: 'truck', label: `City truck ${index + 1}`,
		lengthMeters: 7.1, widthMeters: 2.35, heightMeters: 3.15,
		wheelbaseMeters: 4.1, wheelRadiusMeters: 0.44, wheelCount: 6,
		massTons: 9 + index, topSpeedKph: 100, zeroTo100Seconds: 30,
		roadCruiseKph: [25, 45], traction: 0.73, turnResponse: 0.54,
		bodyColor: [0xd3974f, 0x4b87aa, 0xb8583d, 0x647d52, 0x9b7658][index],
		accentColor: 0xd9d1bd, spawnWeight: 2,
	})),
	...Array.from({ length: 3 }, (_, index): TrafficVehicleModel => ({
		id: `city-bus-${index + 1}`, kind: 'bus', label: `City bus ${index + 1}`,
		lengthMeters: 12.4, widthMeters: 2.5, heightMeters: 3.35,
		wheelbaseMeters: 6.1, wheelRadiusMeters: 0.49, wheelCount: 6,
		massTons: 19.5 + index * 2.5, topSpeedKph: 100, zeroTo100Seconds: 42,
		roadCruiseKph: [25, 42], traction: 0.7, turnResponse: 0.4,
		bodyColor: [0x5897ad, 0xe0aa4d, 0xc15f48][index],
		accentColor: 0xe3e3d1, spawnWeight: 1,
	})),
];

export const TRAFFIC_VEHICLE_MODELS = Object.freeze(trafficModels);
export const TRAFFIC_MODEL_IDS = Object.freeze(trafficModels.map((model) => model.id));

const modelsById = new Map(trafficModels.map((model) => [model.id, model] as const));
const modelsByKind = new Map<TrafficVehicleKind, readonly TrafficVehicleModel[]>(
	TRAFFIC_VEHICLE_KINDS.map((kind) => [
		kind,
		trafficModels.filter((model) => model.kind === kind),
	]),
);

export function getTrafficVehicleModel(id: string): TrafficVehicleModel {
	const model = modelsById.get(id);
	if (!model) throw new Error(`Unknown traffic vehicle model: ${id}.`);
	return model;
}

export function trafficModelsForKind(kind: TrafficVehicleKind): readonly TrafficVehicleModel[] {
	return modelsByKind.get(kind) ?? [];
}

export function chooseTrafficVehicleModel(
	kind: TrafficVehicleKind,
	random: () => number,
): TrafficVehicleModel {
	const choices = trafficModelsForKind(kind);
	const totalWeight = choices.reduce((total, model) => total + model.spawnWeight, 0);
	let pick = random() * totalWeight;
	for (const model of choices) {
		pick -= model.spawnWeight;
		if (pick <= 0) return model;
	}
	return choices[choices.length - 1];
}
