import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { Vector3 } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const assetDirectory = new URL('../src/assets/buildings/', import.meta.url);
const outputUrl = new URL('residential-buildings.bin', assetDirectory);
const textureSourceUrl = new URL('textures/Hotel_Hous_AO.png', assetDirectory);
const textureOutputUrl = new URL('residential-buildings.webp', assetDirectory);
const variantIds = ['001', '002', '003', '004', '005', '006'];
const headerSize = 8 + variantIds.length * 32;

function align(value, alignment) {
	return Math.ceil(value / alignment) * alignment;
}

function quantizeSigned(value, maximum) {
	return Math.round(Math.max(-1, Math.min(1, value)) * maximum);
}

function packGeometry(geometry) {
	const position = geometry.attributes.position;
	const normal = geometry.attributes.normal;
	const uv = geometry.attributes.uv;
	const vertexCount = Math.min(position.count, normal?.count ?? 0, uv?.count ?? 0);
	if (vertexCount === 0 || vertexCount % 3 !== 0) {
		throw new Error('Residential building geometry attributes do not match triangles.');
	}

	const minimum = new Vector3(Infinity, Infinity, Infinity);
	const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
	for (let index = 0; index < vertexCount; index += 1) {
		minimum.min(new Vector3(position.getX(index), position.getY(index), position.getZ(index)));
		maximum.max(new Vector3(position.getX(index), position.getY(index), position.getZ(index)));
	}
	const center = minimum.clone().add(maximum).multiplyScalar(0.5);
	const halfExtent = maximum.clone().sub(minimum).multiplyScalar(0.5);
	const positions = new Int16Array(vertexCount * 3);
	const normals = new Int8Array(vertexCount * 3);
	const uvs = new Int16Array(vertexCount * 2);

	for (let index = 0; index < vertexCount; index += 1) {
		const positionOffset = index * 3;
		positions[positionOffset] = quantizeSigned(
			(position.getX(index) - center.x) / halfExtent.x,
			32767,
		);
		positions[positionOffset + 1] = quantizeSigned(
			(position.getY(index) - center.y) / halfExtent.y,
			32767,
		);
		positions[positionOffset + 2] = quantizeSigned(
			(position.getZ(index) - center.z) / halfExtent.z,
			32767,
		);
		normals[positionOffset] = quantizeSigned(normal.getX(index), 127);
		normals[positionOffset + 1] = quantizeSigned(normal.getY(index), 127);
		normals[positionOffset + 2] = quantizeSigned(normal.getZ(index), 127);
		const uvOffset = index * 2;
		uvs[uvOffset] = quantizeSigned(uv.getX(index), 32767);
		uvs[uvOffset + 1] = quantizeSigned(uv.getY(index), 32767);
	}

	return { vertexCount, halfExtent, positions, normals, uvs };
}

const loader = new OBJLoader();
const variants = [];
for (const id of variantIds) {
	const sourceUrl = new URL(`Residential Buildings ${id}.obj`, assetDirectory);
	const root = loader.parse(await readFile(sourceUrl, 'utf8'));
	const geometry = root.children[0]?.geometry;
	if (!geometry) throw new Error(`Residential building ${id} has no geometry.`);
	variants.push(packGeometry(geometry));
}

let dataOffset = headerSize;
for (const variant of variants) {
	variant.positionOffset = align(dataOffset, 2);
	dataOffset = variant.positionOffset + variant.positions.byteLength;
	variant.normalOffset = dataOffset;
	dataOffset = variant.normalOffset + variant.normals.byteLength;
	variant.uvOffset = align(dataOffset, 2);
	dataOffset = variant.uvOffset + variant.uvs.byteLength;
}

const output = new ArrayBuffer(dataOffset);
const view = new DataView(output);
for (const [index, character] of [...'BLD1'].entries()) view.setUint8(index, character.charCodeAt(0));
view.setUint32(4, variants.length, true);
for (const [index, variant] of variants.entries()) {
	const offset = 8 + index * 32;
	view.setUint32(offset, variant.vertexCount, true);
	view.setFloat32(offset + 4, variant.halfExtent.x, true);
	view.setFloat32(offset + 8, variant.halfExtent.y, true);
	view.setFloat32(offset + 12, variant.halfExtent.z, true);
	view.setUint32(offset + 16, variant.positionOffset, true);
	view.setUint32(offset + 20, variant.normalOffset, true);
	view.setUint32(offset + 24, variant.uvOffset, true);
	new Int16Array(output, variant.positionOffset, variant.positions.length).set(variant.positions);
	new Int8Array(output, variant.normalOffset, variant.normals.length).set(variant.normals);
	new Int16Array(output, variant.uvOffset, variant.uvs.length).set(variant.uvs);
}

await Promise.all([
	writeFile(outputUrl, new Uint8Array(output)),
	sharp(fileURLToPath(textureSourceUrl))
		.resize(1024, 1024, { fit: 'inside' })
		.webp({ quality: 76, effort: 6 })
		.toFile(fileURLToPath(textureOutputUrl)),
]);
console.log(
	`Wrote ${relative(rootDirectory, fileURLToPath(outputUrl))} (${output.byteLength} bytes).`,
);
