import {
    isParallelGroup,
    type ChainItem,
    type Effect,
    type ParallelGroup,
} from '../shared/effects';
import { ParallelStage } from './parallel';
import { BypassStage, EffectStage, type Stage } from './stage';

/**
 * Builds the stage tree for a rack chain. Effects and groups that already existed keep their
 * stage (and with it filter, envelope and delay state), even when they move to another lane.
 */
export class StagePool {
    private effects = new Map<string, BypassStage<EffectStage>>();
    private groups = new Map<string, BypassStage<ParallelStage>>();
    private reusableEffects = new Map<string, BypassStage<EffectStage>>();
    private reusableGroups = new Map<string, BypassStage<ParallelStage>>();

    constructor(private readonly sampleRate: number) {}

    resolve(chain: ChainItem[]): Stage[] {
        this.reusableEffects = this.effects;
        this.reusableGroups = this.groups;
        this.effects = new Map();
        this.groups = new Map();
        const stages = chain.map((item) => this.item(item));
        // Drop stages that are no longer part of the rack.
        this.reusableEffects = new Map();
        this.reusableGroups = new Map();
        return stages;
    }

    private item(item: ChainItem): Stage {
        return isParallelGroup(item) ? this.group(item) : this.effect(item);
    }

    private effect(effect: Effect): BypassStage<EffectStage> {
        const previous = this.reusableEffects.get(effect.id);
        const reusable = previous?.inner.type === effect.type && !this.effects.has(effect.id);
        const stage = reusable
            ? previous
            : new BypassStage(
                  new EffectStage(effect.id, effect.type, this.sampleRate),
                  effect.bypass,
                  this.sampleRate,
              );
        stage.inner.configure(effect.params);
        stage.setBypass(effect.bypass);
        this.effects.set(effect.id, stage);
        return stage;
    }

    private group(group: ParallelGroup): BypassStage<ParallelStage> {
        const previous = this.reusableGroups.get(group.id);
        const stage =
            previous && !this.groups.has(group.id)
                ? previous
                : new BypassStage(
                      new ParallelStage(group.id, this.sampleRate),
                      group.bypass,
                      this.sampleRate,
                  );
        stage.inner.configure(group, (effect) => this.effect(effect));
        stage.setBypass(group.bypass);
        this.groups.set(group.id, stage);
        return stage;
    }
}
