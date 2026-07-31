import * as THREE from 'three';

import assortedCarTextureUrl from '../assets/traffic-models/textures/assorted-car.webp?url';
import cargoTruckTextureUrl from '../assets/traffic-models/textures/cargo-truck.webp?url';
import cityBusTextureUrl from '../assets/traffic-models/textures/city-bus.webp?url';
import cityTruckTextureUrl from '../assets/traffic-models/textures/city-truck.webp?url';
import mclarenTextureUrl from '../assets/traffic-models/textures/mclaren.webp?url';
import motorcycleTextureUrl from '../assets/traffic-models/textures/motorcycle.webp?url';
import traverseTextureUrl from '../assets/traffic-models/textures/traverse.webp?url';
import type { TrafficVehicleModel } from './traffic-vehicle-catalog';

export type TrafficTextureKey =
	| 'assorted-car'
	| 'cargo-truck'
	| 'city-bus'
	| 'city-truck'
	| 'mclaren'
	| 'motorcycle'
	| 'traverse';

const textureUrls: Readonly<Record<TrafficTextureKey, string>> = {
	'assorted-car': assortedCarTextureUrl,
	'cargo-truck': cargoTruckTextureUrl,
	'city-bus': cityBusTextureUrl,
	'city-truck': cityTruckTextureUrl,
	mclaren: mclarenTextureUrl,
	motorcycle: motorcycleTextureUrl,
	traverse: traverseTextureUrl,
};

let textureLoad: Promise<ReadonlyMap<TrafficTextureKey, THREE.Texture>> | undefined;

export function trafficTextureKeyFor(model: TrafficVehicleModel): TrafficTextureKey | undefined {
	if (model.id === 'motorcycle') return 'motorcycle';
	if (model.id === 'honda-civic') return undefined;
	if (model.id === 'mclaren-gts') return 'mclaren';
	if (model.id === 'chevy-traverse') return 'traverse';
	if (model.id.startsWith('cargo-truck-')) return 'cargo-truck';
	if (model.id.startsWith('city-truck-')) return 'city-truck';
	if (model.id.startsWith('city-bus-')) return 'city-bus';
	return 'assorted-car';
}

export function loadTrafficTextures(): Promise<ReadonlyMap<TrafficTextureKey, THREE.Texture>> {
	textureLoad ??= Promise.all(
		(Object.entries(textureUrls) as readonly [TrafficTextureKey, string][]).map(async ([key, url]) => {
			const texture = await new THREE.TextureLoader().loadAsync(url);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.wrapS = THREE.RepeatWrapping;
			texture.wrapT = THREE.RepeatWrapping;
			texture.anisotropy = 1;
			return [key, texture] as const;
		}),
	).then((textures) => new Map(textures));
	return textureLoad;
}
