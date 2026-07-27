import type { VehicleInput } from './vehicle';

export interface PointDriveVehicle {
	x: number;
	z: number;
	heading: number;
	speed: number;
}

export interface PointDriveTarget {
	x: number;
	z: number;
}

const STEERING_DEAD_ZONE = 0.12;
const REVERSE_DOT_THRESHOLD = -0.35;
const SPEED_DIRECTION_DEAD_ZONE = 0.15;

function normalizeAngle(angle: number): number {
	return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function emptyInput(): VehicleInput {
	return { accelerate: false, brake: false, left: false, right: false, handbrake: false };
}

export function pointDriveInput(
	vehicle: PointDriveVehicle,
	target: PointDriveTarget,
): VehicleInput {
	const offsetX = target.x - vehicle.x;
	const offsetZ = target.z - vehicle.z;
	const distance = Math.hypot(offsetX, offsetZ);
	if (distance < 0.001) return emptyInput();

	const targetHeading = Math.atan2(offsetX, offsetZ);
	const forwardX = Math.sin(vehicle.heading);
	const forwardZ = Math.cos(vehicle.heading);
	const forwardDot = (offsetX * forwardX + offsetZ * forwardZ) / distance;
	const reverse = forwardDot < REVERSE_DOT_THRESHOLD;
	const desiredHeading = normalizeAngle(targetHeading + (reverse ? Math.PI : 0));
	const headingError = normalizeAngle(desiredHeading - vehicle.heading);
	const speedDirection = vehicle.speed < -SPEED_DIRECTION_DEAD_ZONE ? -1 : 1;
	const steering =
		Math.abs(headingError) > STEERING_DEAD_ZONE ? Math.sign(headingError) * speedDirection : 0;

	return {
		accelerate: !reverse,
		brake: reverse,
		left: steering > 0,
		right: steering < 0,
		handbrake: false,
	};
}
