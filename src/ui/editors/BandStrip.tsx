import { Segmented } from '../components/Controls';
import { bandLabel } from './bandDisplay';

/** What a band chip marks: a band that is soloed, muted or bypassed. */
export interface BandFlags {
    solo: boolean;
    mute: boolean;
    bypass: boolean;
}

/**
 * The chips of a band-split effect, one per band, to pick the band its controls edit, and the
 * number of bands at the end.
 */
export function BandStrip({
    bands,
    selected,
    onSelect,
    tint,
    counts,
    onCount,
    color,
}: {
    bands: BandFlags[];
    selected: number;
    onSelect: (index: number) => void;
    tint: (index: number) => string;
    /** The band counts offered. */
    counts: number[];
    onCount: (count: number) => void;
    color: string;
}) {
    return (
        <div className="band-strip">
            {bands.map((band, index) => (
                <button
                    type="button"
                    key={index}
                    className={`band-chip ${index === selected ? 'on' : ''}`}
                    style={{ ['--chip-color' as string]: tint(index) }}
                    onClick={() => onSelect(index)}
                >
                    <span>{bandLabel(index, bands.length)}</span>
                    {band.solo && <span className="badge">S</span>}
                    {band.mute && <span className="badge">M</span>}
                    {band.bypass && <span className="badge">B</span>}
                </button>
            ))}
            <div className="band-strip-end">
                <Segmented
                    label="Bands"
                    value={bands.length}
                    options={counts.map((value) => ({ value, label: `${value}` }))}
                    onChange={onCount}
                    color={color}
                />
            </div>
        </div>
    );
}
