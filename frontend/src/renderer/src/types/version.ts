import type { AssemblyProfile } from './clip';
import type {
  CreativeVersion,
  CreativeVersionItem,
  VersionSet as GeneratedVersionSet,
} from './generated';

/** One placement in a proposed cut; it has no live Timeline Item id yet. */
export interface VersionItem extends Omit<CreativeVersionItem, 'speed' | 'transform'> {
  speed: NonNullable<CreativeVersionItem['speed']>;
  transform: { scale: number; x: number; y: number };
}

/** A complete alternative cut that the Editor can preview and adopt. */
export interface Version extends Omit<CreativeVersion, 'profile' | 'items'> {
  profile: AssemblyProfile;
  items: VersionItem[];
}

export interface VersionSet extends Omit<GeneratedVersionSet, 'versions'> {
  versions: Version[];
}
