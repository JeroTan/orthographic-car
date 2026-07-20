export interface ProjectedBuildingBounds {
	x: number;
	y: number;
	z: number;
	radiusX: number;
	radiusY: number;
}

export interface ProjectedCarPoint {
	x: number;
	y: number;
	z: number;
}

const SCREEN_PADDING = 0.015;

export function buildingOccludesCar(
	building: ProjectedBuildingBounds,
	car: ProjectedCarPoint,
): boolean {
	if (building.z >= car.z) return false;
	return (
		Math.abs(building.x - car.x) <= building.radiusX + SCREEN_PADDING &&
		Math.abs(building.y - car.y) <= building.radiusY + SCREEN_PADDING
	);
}
