import { requireCi } from './target.mjs';

const digest = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');
const manifestTypes = new Set(['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json']);

/** record происходит из полного OCI/provenance proof. ID Docker store не подменяет configDigest в receipt. */
export function verifyRuntimeImageProjection(image, record, code = 'runtime-image-projection') {
  const descriptor = image?.Descriptor;
  const exactManifest = descriptor?.digest === record?.manifestDigest && manifestTypes.has(descriptor?.mediaType) &&
    (!descriptor.platform || (descriptor.platform.os === 'linux' && descriptor.platform.architecture === 'amd64'));
  const classic = image?.Id === record?.configDigest && (!descriptor || exactManifest);
  const containerd = image?.Id === record?.manifestDigest && exactManifest;
  requireCi(digest(record?.configDigest) && digest(record?.manifestDigest) && (classic || containerd) &&
    image.Os === 'linux' && image.Architecture === 'amd64' &&
    Array.isArray(record.diffIds) && record.diffIds.length > 0 && record.diffIds.every(digest) &&
    JSON.stringify(image.RootFS?.Layers) === JSON.stringify(record.diffIds), code);
  return image.Id;
}
