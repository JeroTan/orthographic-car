import * as THREE from 'three';

import buildingModelUrl from '../assets/buildings/residential-buildings.bin?url';
import buildingTextureUrl from '../assets/buildings/residential-buildings.webp?url';
import { buildingOccludesCar } from './building-occlusion';
import {
	type BuildingVariant,
	type WorldLayout,
	type WorldPoint,
} from './world';

export interface BuildingView {
	update(carPosition: WorldPoint): void;
	destroy(): void;
}

interface PackedBuildingVariant {
	geometry: THREE.BufferGeometry;
	halfExtent: THREE.Vector3;
}

interface BuildingInstances {
	mesh: THREE.InstancedMesh;
	packed: PackedBuildingVariant;
	placements: WorldLayout['buildings'];
	opacity: THREE.InstancedBufferAttribute;
}

interface TransformScratch {
	matrix: THREE.Matrix4;
	position: THREE.Vector3;
	rotation: THREE.Quaternion;
	euler: THREE.Euler;
	scale: THREE.Vector3;
	worldCenter: THREE.Vector3;
	projectedCar: THREE.Vector3;
	projectedCorners: THREE.Vector3[];
}

const VARIANT_COUNT = 6;
const SECTION_HEADER_SIZE = 32;
const BUILDING_MODEL_SCALE = 0.36;
const OCCLUDED_BUILDING_OPACITY = 0.1;
const OPACITY_RESPONSE = 0.22;
const VARIANT_COLORS = [0xd9c7ad, 0xc9b28f, 0xc48f79, 0xa8bec2, 0xa7b49a, 0xb8afa4] as const;

function assertViewRange(buffer: ArrayBuffer, offset: number, byteLength: number): void {
	if (offset < 0 || byteLength < 0 || offset + byteLength > buffer.byteLength) {
		throw new Error('Residential building model contains an invalid attribute range.');
	}
}

function parseBuildingModel(buffer: ArrayBuffer): PackedBuildingVariant[] {
	if (buffer.byteLength < 8 + VARIANT_COUNT * SECTION_HEADER_SIZE) {
		throw new Error('Residential building model header is incomplete.');
	}
	const view = new DataView(buffer);
	const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
	if (magic !== 'BLD1' || view.getUint32(4, true) !== VARIANT_COUNT) {
		throw new Error('Residential building model header is invalid.');
	}

	return Array.from({ length: VARIANT_COUNT }, (_, index) => {
		const offset = 8 + index * SECTION_HEADER_SIZE;
		const vertexCount = view.getUint32(offset, true);
		const halfExtent = new THREE.Vector3(
			view.getFloat32(offset + 4, true),
			view.getFloat32(offset + 8, true),
			view.getFloat32(offset + 12, true),
		);
		const positionOffset = view.getUint32(offset + 16, true);
		const normalOffset = view.getUint32(offset + 20, true);
		const uvOffset = view.getUint32(offset + 24, true);
		if (vertexCount === 0 || vertexCount % 3 !== 0 || positionOffset % 2 !== 0 || uvOffset % 2 !== 0) {
			throw new Error('Residential building model attributes are invalid.');
		}
		assertViewRange(buffer, positionOffset, vertexCount * 3 * Int16Array.BYTES_PER_ELEMENT);
		assertViewRange(buffer, normalOffset, vertexCount * 3 * Int8Array.BYTES_PER_ELEMENT);
		assertViewRange(buffer, uvOffset, vertexCount * 2 * Int16Array.BYTES_PER_ELEMENT);

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			'position',
			new THREE.Int16BufferAttribute(new Int16Array(buffer, positionOffset, vertexCount * 3), 3, true),
		);
		geometry.setAttribute(
			'normal',
			new THREE.Int8BufferAttribute(new Int8Array(buffer, normalOffset, vertexCount * 3), 3, true),
		);
		geometry.setAttribute(
			'uv',
			new THREE.Int16BufferAttribute(new Int16Array(buffer, uvOffset, vertexCount * 2), 2, true),
		);
		geometry.computeBoundingSphere();
		return { geometry, halfExtent };
	});
}

function addVariantInstances(
	scene: THREE.Scene,
	layout: WorldLayout,
	variant: BuildingVariant,
	packed: PackedBuildingVariant,
	material: THREE.Material,
): BuildingInstances | undefined {
	const placements = layout.buildings.filter((building) => building.variant === variant);
	if (placements.length === 0) return undefined;

	const mesh = new THREE.InstancedMesh(packed.geometry, material, placements.length);
	const opacity = new THREE.InstancedBufferAttribute(
		new Float32Array(placements.length).fill(1),
		1,
	);
	mesh.geometry.setAttribute('instanceOpacity', opacity);
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.frustumCulled = false;
	scene.add(mesh);
	return { mesh, packed, placements, opacity };
}

function createBuildingMaterial(
	texture: THREE.Texture,
	color: number,
): THREE.MeshLambertMaterial {
	const material = new THREE.MeshLambertMaterial({
		map: texture,
		color,
		transparent: true,
		// Keep depth writes enabled. Buildings render after opaque car meshes,
		// so faded fragments still reveal car while solid fragments occlude it.
		// Disabling depth writes makes every facade blend with its own backfaces,
		// which produces the hollow/fragmented buildings seen in regression.
		depthWrite: true,
	});
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;',
			)
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying float vInstanceOpacity;')
			.replace(
				'#include <color_fragment>',
				'#include <color_fragment>\ndiffuseColor.a *= vInstanceOpacity;',
			);
	};
	material.customProgramCacheKey = () => 'residential-building-opacity-v1';
	return material;
}

function wrappedNear(value: number, origin: number, span: number): number {
	return origin + ((((value - origin + span / 2) % span) + span) % span) - span / 2;
}

function updateInstances(
	instances: readonly BuildingInstances[],
	carPosition: WorldPoint,
	worldSpan: number,
	camera: THREE.Camera,
	scratch: TransformScratch,
): void {
	scratch.projectedCar.set(carPosition.x, 0.85, carPosition.z).project(camera);
	for (const variantInstances of instances) {
		for (let index = 0; index < variantInstances.placements.length; index += 1) {
			const building = variantInstances.placements[index];
			const modelScale = BUILDING_MODEL_SCALE * building.scale;
			scratch.position.set(
				wrappedNear(building.x, carPosition.x, worldSpan),
				variantInstances.packed.halfExtent.y * modelScale + 0.02,
				wrappedNear(building.z, carPosition.z, worldSpan),
			);
			scratch.rotation.setFromEuler(scratch.euler.set(0, building.rotation, 0));
			scratch.scale.copy(variantInstances.packed.halfExtent).multiplyScalar(modelScale);
			scratch.matrix.compose(scratch.position, scratch.rotation, scratch.scale);
			variantInstances.mesh.setMatrixAt(index, scratch.matrix);

			scratch.worldCenter.copy(scratch.position);
			let minX = Infinity;
			let maxX = -Infinity;
			let minY = Infinity;
			let maxY = -Infinity;
			let minZ = Infinity;
			let maxZ = -Infinity;
			for (let cornerIndex = 0; cornerIndex < 8; cornerIndex += 1) {
				const corner = scratch.projectedCorners[cornerIndex]
					.set(
						(cornerIndex & 1 ? 1 : -1) * scratch.scale.x,
						(cornerIndex & 2 ? 1 : -1) * scratch.scale.y,
						(cornerIndex & 4 ? 1 : -1) * scratch.scale.z,
					)
					.applyQuaternion(scratch.rotation)
					.add(scratch.worldCenter)
					.project(camera);
				minX = Math.min(minX, corner.x);
				maxX = Math.max(maxX, corner.x);
				minY = Math.min(minY, corner.y);
				maxY = Math.max(maxY, corner.y);
				minZ = Math.min(minZ, corner.z);
				maxZ = Math.max(maxZ, corner.z);
			}
			const occluded = buildingOccludesCar(
				{
					x: (minX + maxX) / 2,
					y: (minY + maxY) / 2,
					z: (minZ + maxZ) / 2,
					radiusX: (maxX - minX) / 2,
					radiusY: (maxY - minY) / 2,
				},
				{
					x: scratch.projectedCar.x,
					y: scratch.projectedCar.y,
					z: scratch.projectedCar.z,
				},
			);
			const targetOpacity = occluded ? OCCLUDED_BUILDING_OPACITY : 1;
			const currentOpacity = variantInstances.opacity.getX(index);
			variantInstances.opacity.setX(
				index,
				currentOpacity + (targetOpacity - currentOpacity) * OPACITY_RESPONSE,
			);
		}
		variantInstances.mesh.instanceMatrix.needsUpdate = true;
		variantInstances.opacity.needsUpdate = true;
	}
}

export function addBuildingView(
	scene: THREE.Scene,
	layout: WorldLayout,
	onAssetReady: () => void,
	camera: THREE.Camera,
): BuildingView {
	let destroyed = false;
	let loadedTexture: THREE.Texture | undefined;
	let loadedVariants: PackedBuildingVariant[] = [];
	let latestCarPosition: WorldPoint = { x: 0, z: 0 };
	const instances: BuildingInstances[] = [];
	const transformScratch: TransformScratch = {
		matrix: new THREE.Matrix4(),
		position: new THREE.Vector3(),
		rotation: new THREE.Quaternion(),
		euler: new THREE.Euler(),
		scale: new THREE.Vector3(),
		worldCenter: new THREE.Vector3(),
		projectedCar: new THREE.Vector3(),
		projectedCorners: Array.from({ length: 8 }, () => new THREE.Vector3()),
	};
	void Promise.all([
		fetch(buildingModelUrl),
		new THREE.TextureLoader().loadAsync(buildingTextureUrl),
	])
		.then(async ([response, texture]) => {
			if (!response.ok) throw new Error(`Residential building request failed with ${response.status}.`);
			const variants = parseBuildingModel(await response.arrayBuffer());
			if (destroyed) {
				for (const variant of variants) variant.geometry.dispose();
				texture.dispose();
				return;
			}

			texture.colorSpace = THREE.SRGBColorSpace;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.magFilter = THREE.LinearFilter;
			loadedTexture = texture;
			loadedVariants = variants;
			for (let index = 0; index < variants.length; index += 1) {
				const material = createBuildingMaterial(texture, VARIANT_COLORS[index]);
				const variantInstances = addVariantInstances(
					scene,
					layout,
					index as BuildingVariant,
					variants[index],
					material,
				);
				if (variantInstances) instances.push(variantInstances);
			}
			updateInstances(instances, latestCarPosition, layout.worldSpan, camera, transformScratch);
			onAssetReady();
		})
		.catch((error: unknown) => {
			console.warn('Residential buildings could not load.', error);
		});

	return {
		update(carPosition) {
			latestCarPosition = carPosition;
			if (instances.length > 0) {
				updateInstances(instances, carPosition, layout.worldSpan, camera, transformScratch);
			}
		},
		destroy() {
			destroyed = true;
			for (const variant of loadedVariants) variant.geometry.dispose();
			loadedTexture?.dispose();
		},
	};
}
