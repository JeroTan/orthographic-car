import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Box3, Matrix3, Vector3 } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const execFileAsync = promisify(execFile);
const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const outputUrl = new URL('../src/assets/traffic-models/traffic-models.bin', import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const METERS_PER_WORLD_UNIT = 4.469 / 4.908842;
const ID_BYTES = 32;
const RECORD_BYTES = 76;

// FBXLoader only touches these browser globals while parsing embedded texture links.
globalThis.document = {
	createElementNS: () => ({
		addEventListener() {},
		removeEventListener() {},
		set src(_value) {},
		get src() { return ''; },
	}),
};
globalThis.window = {
	URL: { createObjectURL: () => '', revokeObjectURL() {} },
};

const sources = {
	assortedCars: new URL('../src/assets/assorted-cars/source/untitled.fbx', import.meta.url),
	assortedTruckBus: new URL('../src/assets/assorted-truck-and-bus/source/untitled.fbx', import.meta.url),
	hondaCivic: new URL('../src/assets/car-honda-civic/source/honda civic low poly.fbx', import.meta.url),
	truckCollection: new URL('../src/assets/trucks-collection/source/Truck_collection.fbx', import.meta.url),
	motorcycle: new URL('../src/assets/motorcycles/source/Low-Poly Motorcycle %232.zip', import.meta.url),
	traverse: new URL('../src/assets/pickup-2024-chevrolet-traverse/source/Ps1 Low-Poly 2024 Chevrolet Traverse.rar', import.meta.url),
	mclaren: new URL('../src/assets/supercar-2024-mclaren-gts/source/Ps1 Low-poly 2024 Mclaren GTS.rar', import.meta.url),
};

const targetDimensions = {
	'motorcycle': [0.85, 2.07, 1.17],
	'honda-civic': [1.76, 4.25, 1.46],
	'mclaren-gts': [2.1, 4.68, 1.21],
	'chevy-traverse': [1.99, 5.19, 1.79],
	'toyota-alphard': [1.85, 4.95, 1.94],
	'civic-police': [1.76, 4.25, 1.46],
	'daihatsu-xenia': [1.66, 4.19, 1.7],
	'wuling-ev': [1.49, 2.92, 1.62],
	'pickup': [1.97, 5.46, 1.93],
	'wuling-ev-blue': [1.49, 2.92, 1.62],
	'box-van': [1.9, 4.8, 2.05],
	'suzuki-carry': [1.77, 4.2, 1.91],
	'toyota-fortuner': [1.86, 4.8, 1.84],
	'ambulance': [2, 5.3, 2.35],
	'toyota-innova': [1.83, 4.74, 1.8],
	'isuzu-trooper': [1.84, 4.66, 1.84],
	'civic-civilian': [1.76, 4.25, 1.46],
	...Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
		`cargo-truck-${index + 1}`, [2.5, 8.2, 3.45],
	])),
	...Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
		`city-truck-${index + 1}`, [2.35, 7.1, 3.15],
	])),
	...Object.fromEntries(Array.from({ length: 3 }, (_, index) => [
		`city-bus-${index + 1}`, [2.5, 12.4, 3.35],
	])),
};

function align(value, alignment) {
	return Math.ceil(value / alignment) * alignment;
}

function quantizeSigned(value, maximum) {
	return Math.round(Math.max(-1, Math.min(1, value)) * maximum);
}

function quantizeUv(value) {
	const wrapped = value - Math.floor(value);
	return Math.round(Math.max(0, Math.min(1, wrapped)) * 65535);
}

async function parseFbx(path) {
	const source = await readFile(path);
	const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	return new FBXLoader().parse(arrayBuffer, dirname(path));
}

async function extractedFbx(archiveUrl) {
	const directory = await mkdtemp(join(tmpdir(), 'orthographic-traffic-model-'));
	try {
		await execFileAsync('7z', ['e', '-y', `-o${directory}`, fileURLToPath(archiveUrl)]);
		const files = await readdir(directory, { recursive: true });
		const fbx = files.find((file) => extname(file).toLowerCase() === '.fbx');
		if (!fbx) throw new Error(`No FBX file found in ${fileURLToPath(archiveUrl)}.`);
		return { directory, path: join(directory, fbx) };
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

function allMeshes(root) {
	const meshes = [];
	root.traverse((object) => {
		if (object.isMesh && object.geometry?.attributes.position) meshes.push(object);
	});
	return meshes;
}

function meshesNamed(root, names) {
	const expected = new Set(names);
	const meshes = allMeshes(root).filter((mesh) => expected.has(mesh.name));
	if (meshes.length !== names.length) {
		throw new Error(`Missing expected mesh. Wanted: ${names.join(', ')}. Found: ${meshes.map((mesh) => mesh.name).join(', ')}.`);
	}
	return meshes;
}

function meshSubtreeNamed(root, name) {
	let selected;
	root.traverse((object) => {
		if (!selected && object.name === name) selected = object;
	});
	if (!selected) throw new Error(`Missing expected mesh subtree: ${name}.`);
	const meshes = [];
	selected.traverse((object) => {
		if (object.isMesh && object.geometry?.attributes.position) meshes.push(object);
	});
	return meshes;
}

function sourceBoundsForMeshes(meshes) {
	const bounds = new Box3();
	for (const mesh of meshes) {
		mesh.geometry.computeBoundingBox();
		if (!mesh.geometry.boundingBox) continue;
		bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
	}
	if (bounds.isEmpty()) throw new Error('Vehicle mesh has no bounds.');
	return bounds;
}

function meshGroupsByCenterXFrom(meshes, centers) {
	return centers.map((center) => meshes.filter((mesh) => {
		mesh.geometry.computeBoundingBox();
		const bounds = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld);
		if (!bounds) return false;
		const meshCenter = bounds.getCenter(new Vector3()).x;
		const nearest = centers.reduce((best, candidate) =>
			Math.abs(candidate - meshCenter) < Math.abs(best - meshCenter) ? candidate : best,
		centers[0]);
		return nearest === center;
	}));
}

function meshGroupsByCenterX(root, centers) {
	return meshGroupsByCenterXFrom(allMeshes(root), centers);
}

function meshGroupsByCenter(root, centers) {
	const meshes = allMeshes(root);
	return centers.map((center) => meshes.filter((mesh) => {
		mesh.geometry.computeBoundingBox();
		const bounds = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld);
		if (!bounds) return false;
		const meshCenter = bounds.getCenter(new Vector3());
		const nearest = centers.reduce((best, candidate) =>
			Math.hypot(candidate[0] - meshCenter.x, candidate[1] - meshCenter.z) <
			Math.hypot(best[0] - meshCenter.x, best[1] - meshCenter.z)
				? candidate
				: best,
		centers[0]);
		return nearest === center;
	}));
}

function packModel(id, meshes) {
	if (id.length > ID_BYTES) throw new Error(`Model id is too long: ${id}.`);
	const dimensions = targetDimensions[id];
	if (!dimensions) throw new Error(`No target dimensions for ${id}.`);
	for (const mesh of meshes) mesh.updateWorldMatrix(true, false);
	const sourceBounds = sourceBoundsForMeshes(meshes);
	const sourceCenter = sourceBounds.getCenter(new Vector3());
	const sourceSize = sourceBounds.getSize(new Vector3());
	if (sourceSize.x <= 0 || sourceSize.y <= 0 || sourceSize.z <= 0) {
		throw new Error(`Vehicle mesh has degenerate bounds: ${id}.`);
	}
	const [targetWidth, targetLength, targetHeight] = dimensions;
	const positionValues = [];
	const normalValues = [];
	const uvValues = [];
	const normalMatrix = new Matrix3();
	const position = new Vector3();
	const normal = new Vector3();

	for (const mesh of meshes) {
		const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
		const positionAttribute = geometry.getAttribute('position');
		const uvAttribute = geometry.getAttribute('uv');
		let normalAttribute = geometry.getAttribute('normal');
		if (!normalAttribute) {
			geometry.computeVertexNormals();
			normalAttribute = geometry.getAttribute('normal');
		}
		normalMatrix.getNormalMatrix(mesh.matrixWorld);
		for (let index = 0; index < positionAttribute.count; index += 1) {
			position.set(positionAttribute.getX(index), positionAttribute.getY(index), positionAttribute.getZ(index));
			position.applyMatrix4(mesh.matrixWorld);
			positionValues.push(
				((position.x - sourceCenter.x) / sourceSize.x) * targetWidth,
				((position.y - sourceBounds.min.y) / sourceSize.y) * targetHeight,
				((position.z - sourceCenter.z) / sourceSize.z) * targetLength,
			);
			normal.set(normalAttribute.getX(index), normalAttribute.getY(index), normalAttribute.getZ(index));
			normal.applyMatrix3(normalMatrix).normalize();
			normalValues.push(normal.x, normal.y, normal.z);
			uvValues.push(
				quantizeUv(uvAttribute?.getX(index) ?? 0.5),
				quantizeUv(uvAttribute?.getY(index) ?? 0.5),
			);
		}
		geometry.dispose();
	}

	const vertexCount = positionValues.length / 3;
	const positions = new Int16Array(vertexCount * 3);
	const normals = new Int8Array(vertexCount * 3);
	const uvs = new Uint16Array(uvValues);
	for (let index = 0; index < vertexCount; index += 1) {
		const offset = index * 3;
		positions[offset] = quantizeSigned(positionValues[offset] / (targetWidth / 2), 32767);
		positions[offset + 1] = quantizeSigned(
			(positionValues[offset + 1] - targetHeight / 2) / (targetHeight / 2),
			32767,
		);
		positions[offset + 2] = quantizeSigned(positionValues[offset + 2] / (targetLength / 2), 32767);
		normals[offset] = quantizeSigned(normalValues[offset], 127);
		normals[offset + 1] = quantizeSigned(normalValues[offset + 1], 127);
		normals[offset + 2] = quantizeSigned(normalValues[offset + 2], 127);
	}
	return {
		id,
		vertexCount,
		center: [0, targetHeight / 2, 0],
		halfExtent: [targetWidth / 2, targetHeight / 2, targetLength / 2],
		positions,
		normals,
		uvs,
	};
}

async function loadArchiveRoot(archiveUrl) {
	const extracted = await extractedFbx(archiveUrl);
	try {
		return await parseFbx(extracted.path);
	} finally {
		await rm(extracted.directory, { recursive: true, force: true });
	}
}

const [assortedCars, assortedTruckBus, hondaCivic, truckCollection, motorcycle, traverse, mclaren] = await Promise.all([
	parseFbx(fileURLToPath(sources.assortedCars)),
	parseFbx(fileURLToPath(sources.assortedTruckBus)),
	parseFbx(fileURLToPath(sources.hondaCivic)),
	parseFbx(fileURLToPath(sources.truckCollection)),
	loadArchiveRoot(sources.motorcycle),
	loadArchiveRoot(sources.traverse),
	loadArchiveRoot(sources.mclaren),
]);

for (const source of [assortedCars, assortedTruckBus, hondaCivic, truckCollection, motorcycle, traverse, mclaren]) {
	source.updateMatrixWorld(true);
}

const truckGroups = meshGroupsByCenterX(truckCollection, [-1378, -679, 20, 725, 1457]);
const truckBusGroups = meshGroupsByCenter(assortedTruckBus, [
	[-173, 258],
	[-57, 263],
	[56, 272],
	[180, 291],
	[291, 282],
	[-142, -427],
	[145, -437],
	[-51, -9],
]);
const lowerRowGroups = meshGroupsByCenterXFrom(
	truckBusGroups[7],
	[-317.7, -179.5, -51.45, 60.97, 179.78],
);
const thirdBusGroup = lowerRowGroups[2];
const packedModels = [
	packModel('motorcycle', meshSubtreeNamed(motorcycle, 'Body_003')),
	packModel('honda-civic', allMeshes(hondaCivic)),
	packModel('mclaren-gts', allMeshes(mclaren)),
	packModel('chevy-traverse', allMeshes(traverse)),
	packModel('toyota-alphard', meshesNamed(assortedCars, ['Toyota_Alphard'])),
	packModel('civic-police', meshesNamed(assortedCars, ['Honda_Civic_Polisi'])),
	packModel('daihatsu-xenia', meshesNamed(assortedCars, ['Dihatsu_Xenia'])),
	packModel('wuling-ev', meshesNamed(assortedCars, ['Wuling_EV'])),
	packModel('pickup', meshesNamed(assortedCars, ['Pickup'])),
	packModel('wuling-ev-blue', meshesNamed(assortedCars, ['Wuling_EV_Bue'])),
	packModel('box-van', meshesNamed(assortedCars, ['Box'])),
	packModel('suzuki-carry', meshesNamed(assortedCars, ['Suzuki_Carry_Ankot'])),
	packModel('toyota-fortuner', meshesNamed(assortedCars, ['Toyota_Fortuner'])),
	packModel('ambulance', meshesNamed(assortedCars, ['Ambulance'])),
	packModel('toyota-innova', meshesNamed(assortedCars, ['Toyota_Innova'])),
	packModel('isuzu-trooper', meshesNamed(assortedCars, ['Isuzu_Trooper'])),
	packModel('civic-civilian', meshesNamed(assortedCars, ['Honda_Civic_Civillian'])),
	...truckGroups.map((group, index) => packModel(`cargo-truck-${index + 1}`, group)),
	...truckBusGroups.slice(0, 5).map((group, index) => packModel(`city-truck-${index + 1}`, group)),
	...truckBusGroups.slice(5, 7).map((group, index) => packModel(`city-bus-${index + 1}`, group)),
	packModel('city-bus-3', thirdBusGroup),
];

const headerSize = 12 + packedModels.length * RECORD_BYTES;
let dataOffset = headerSize;
for (const model of packedModels) {
	model.positionOffset = align(dataOffset, Int16Array.BYTES_PER_ELEMENT);
	dataOffset = model.positionOffset + model.positions.byteLength;
	model.normalOffset = dataOffset;
	dataOffset = model.normalOffset + model.normals.byteLength;
	model.uvOffset = align(dataOffset, Uint16Array.BYTES_PER_ELEMENT);
	dataOffset = model.uvOffset + model.uvs.byteLength;
}

const output = new ArrayBuffer(dataOffset);
const view = new DataView(output);
for (const [index, character] of [...'TVM2'].entries()) view.setUint8(index, character.charCodeAt(0));
view.setUint32(4, packedModels.length, true);
view.setUint32(8, headerSize, true);
for (const [index, model] of packedModels.entries()) {
	const offset = 12 + index * RECORD_BYTES;
	const idBytes = new TextEncoder().encode(model.id);
	view.setUint8(offset, idBytes.length);
	new Uint8Array(output, offset + 1, idBytes.length).set(idBytes);
	view.setUint32(offset + 36, model.vertexCount, true);
	for (let value = 0; value < 3; value += 1) {
		view.setFloat32(offset + 40 + value * 4, model.center[value], true);
		view.setFloat32(offset + 52 + value * 4, model.halfExtent[value], true);
	}
	view.setUint32(offset + 64, model.positionOffset, true);
	view.setUint32(offset + 68, model.normalOffset, true);
	view.setUint32(offset + 72, model.uvOffset, true);
	new Int16Array(output, model.positionOffset, model.positions.length).set(model.positions);
	new Int8Array(output, model.normalOffset, model.normals.length).set(model.normals);
	new Uint16Array(output, model.uvOffset, model.uvs.length).set(model.uvs);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, new Uint8Array(output));
console.log(`Wrote ${outputPath.slice(rootDirectory.length + 1)} (${output.byteLength} bytes, ${packedModels.length} models, ${METERS_PER_WORLD_UNIT.toFixed(6)} m/unit).`);
