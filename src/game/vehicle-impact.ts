export interface VehicleImpactBody {
	x: number;
	z: number;
	velocityX: number;
	velocityZ: number;
	radius: number;
	mass: number;
}

export interface VehicleImpactChange {
	velocityX: number;
	velocityZ: number;
	correctionX: number;
	correctionZ: number;
}

export interface VehicleImpactEffect extends VehicleImpactChange {
	verticalVelocity: number;
	intensity: number;
	damage?: number;
}

export interface VehicleImpact {
	first: VehicleImpactChange;
	second: VehicleImpactChange;
	normalX: number;
	normalZ: number;
	closingSpeed: number;
	impulse: number;
	intensity: number;
}

const RESTITUTION = 0.25;
const MAX_IMPULSE = 34;
const EPSILON = 0.0001;

function wrappedDelta(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function safeMass(value: number): number {
	return Math.max(0.05, Number.isFinite(value) ? value : 1);
}

export function clampVelocityMagnitude(
	x: number,
	z: number,
	maximum: number,
): { x: number; z: number } {
	const magnitude = Math.hypot(x, z);
	if (magnitude <= maximum || magnitude === 0) return { x, z };
	const scale = maximum / magnitude;
	return { x: x * scale, z: z * scale };
}

export function resolveVehicleImpact(
	first: VehicleImpactBody,
	second: VehicleImpactBody,
	worldSpan: number,
): VehicleImpact | undefined {
	const radius = Math.max(0, first.radius) + Math.max(0, second.radius);
	const deltaX = wrappedDelta(second.x - first.x, worldSpan);
	const deltaZ = wrappedDelta(second.z - first.z, worldSpan);
	const distance = Math.hypot(deltaX, deltaZ);
	if (distance >= radius) return undefined;

	const firstMass = safeMass(first.mass);
	const secondMass = safeMass(second.mass);
	const inverseFirstMass = 1 / firstMass;
	const inverseSecondMass = 1 / secondMass;
	const inverseMassTotal = inverseFirstMass + inverseSecondMass;
	const travelX = first.velocityX - second.velocityX;
	const travelZ = first.velocityZ - second.velocityZ;
	const travelLength = Math.hypot(travelX, travelZ);
	const normalX = distance > EPSILON ? deltaX / distance : travelLength > EPSILON ? travelX / travelLength : 0;
	const normalZ = distance > EPSILON ? deltaZ / distance : travelLength > EPSILON ? travelZ / travelLength : 1;
	const relativeVelocityX = second.velocityX - first.velocityX;
	const relativeVelocityZ = second.velocityZ - first.velocityZ;
	const closingSpeed = Math.max(
		0,
		-(relativeVelocityX * normalX + relativeVelocityZ * normalZ),
	);
	const impulse = Math.min(
		MAX_IMPULSE,
		((1 + RESTITUTION) * closingSpeed) / inverseMassTotal,
	);
	const penetration = radius - distance;
	const intensity = Math.min(1, closingSpeed / 28 + (penetration / Math.max(radius, EPSILON)) * 0.2);

	return {
		first: {
			velocityX: -normalX * impulse * inverseFirstMass,
			velocityZ: -normalZ * impulse * inverseFirstMass,
			correctionX: -normalX * penetration * (inverseFirstMass / inverseMassTotal),
			correctionZ: -normalZ * penetration * (inverseFirstMass / inverseMassTotal),
		},
		second: {
			velocityX: normalX * impulse * inverseSecondMass,
			velocityZ: normalZ * impulse * inverseSecondMass,
			correctionX: normalX * penetration * (inverseSecondMass / inverseMassTotal),
			correctionZ: normalZ * penetration * (inverseSecondMass / inverseMassTotal),
		},
		normalX,
		normalZ,
		closingSpeed,
		impulse,
		intensity,
	};
}
