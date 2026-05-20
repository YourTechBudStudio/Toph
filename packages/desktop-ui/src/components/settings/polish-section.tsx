import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { WandSparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';

import type {
  DesktopApi,
  DictionaryEntryDraft,
  DictionaryEntrySummary,
  PolishRulePresetDraft,
  PolishRulePresetSummary,
} from '@toph/desktop-contracts';
import { MAX_POLISH_RULE_PRESETS as maxPolishRulePresets } from '@toph/desktop-contracts';

import { Button } from '../button';
import { ModalShell } from '../modal';
import {
  SettingsIcon,
  SettingsNumberInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from './settings-controls';

const hiddenScrollbarClass = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

function SortableRuleButton({
  preset,
  index,
  selected,
  active,
  onSelect,
}: {
  preset: PolishRulePresetSummary;
  index: number;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: preset.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-80' : ''}
    >
      <button
        type="button"
        className={`grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-2xl border px-3 py-3 text-left transition-colors duration-200 ${selected ? 'border-accent-blue/45 bg-accent-blue/10' : 'border-white/6 bg-white/3 hover:bg-white/6'}`}
        onClick={onSelect}
      >
        <span
          {...attributes}
          {...listeners}
          className="mt-0.5 inline-flex cursor-grab items-center gap-1 rounded-lg border border-white/8 bg-white/5 px-2 py-1 text-[11px] font-bold text-text-tertiary active:cursor-grabbing"
          aria-label={`Reorder ${preset.title}`}
        >
          <span className="text-text-secondary">{index + 1}</span>
          <span aria-hidden="true">⋮⋮</span>
        </span>
        <span className="min-w-0">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">{preset.title}</span>
            {active && (
              <span className="rounded-full bg-accent-green/12 px-2 py-0.5 text-[11px] font-semibold text-accent-green">
                Active
              </span>
            )}
          </span>
          <span className="mt-1 line-clamp-2 text-xs leading-snug text-text-tertiary">
            {preset.description}
          </span>
        </span>
      </button>
    </div>
  );
}

function AutoGrowTextarea({
  className = '',
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      value={value}
      rows={1}
      className={`box-border resize-none overflow-hidden ${className}`}
    />
  );
}

function RulesModal({
  rulePresets,
  activeRulePresetId,
  disabled,
  client,
  onClose,
}: {
  rulePresets: PolishRulePresetSummary[];
  activeRulePresetId: string | null;
  disabled: boolean;
  client: DesktopApi;
  onClose: () => void;
}) {
  const firstId = activeRulePresetId ?? rulePresets[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const selected = rulePresets.find((preset) => preset.id === selectedId) ?? null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setDescription(selected.description);
      setBody(selected.body);
      return;
    }

    if (!selected) {
      setTitle('');
      setDescription('');
      setBody('');
    }
  }, [selected]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Very rude.');
    } finally {
      setBusy(false);
    }
  };

  const createCustom = async (draft: PolishRulePresetDraft) =>
    run(async () => {
      await client.createPolishRulePreset(draft);
    });

  const draft = (): PolishRulePresetDraft => ({ title, description, body });
  const canAddRule = rulePresets.length < maxPolishRulePresets;
  const canDeleteSelected =
    selected && rulePresets.length > 1 && activeRulePresetId !== selected.id;
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = rulePresets.findIndex((preset) => preset.id === active.id);
    const newIndex = rulePresets.findIndex((preset) => preset.id === over.id);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const ids = arrayMove(rulePresets, oldIndex, newIndex).map((preset) => preset.id);
    void run(() => client.reorderPolishRulePresets(ids));
  };

  return (
    <ModalShell
      eyebrow="Rules"
      title="Manage writing rules"
      titleId="rules-modal-title"
      description="Reorder rules to choose their number in the quick switcher. I promise not to make sorting a distributed systems problem."
      size="lg"
      onClose={onClose}
      footer={
        <>
          {selected && (
            <Button
              onClick={() => void run(() => client.duplicatePolishRulePreset(selected.id))}
              disabled={disabled || busy || !canAddRule}
            >
              Duplicate
            </Button>
          )}
          {selected && (
            <Button
              variant="danger"
              onClick={() => void run(() => client.deletePolishRulePreset(selected.id))}
              disabled={disabled || busy || !canDeleteSelected}
            >
              Delete
            </Button>
          )}
          {selected && (
            <Button
              onClick={() => void run(() => client.updatePolishRulePreset(selected.id, draft()))}
              disabled={disabled || busy}
            >
              Save
            </Button>
          )}
          {!selected && (
            <Button
              onClick={() => void createCustom(draft())}
              disabled={disabled || busy || !canAddRule}
            >
              Create
            </Button>
          )}
          {selected && (
            <Button
              variant="primary"
              onClick={() => void run(() => client.setActivePolishRulePreset(selected.id))}
              disabled={disabled || busy || activeRulePresetId === selected.id}
            >
              Use this preset
            </Button>
          )}
        </>
      }
    >
      <div className="grid h-full min-h-0 overflow-hidden grid-cols-[17rem_minmax(0,1fr)] max-[820px]:grid-cols-1 max-[820px]:grid-rows-[minmax(0,14rem)_minmax(0,1fr)]">
        <aside
          className={`min-h-0 overscroll-contain overflow-y-auto border-r border-white/6 p-4 max-[820px]:border-r-0 max-[820px]:border-b ${hiddenScrollbarClass}`}
        >
          <Button
            className="mb-3 w-full"
            onClick={() => {
              setSelectedId(null);
              setTitle('My rules');
              setDescription('Personal house style for when the defaults start unionizing.');
              setBody('');
            }}
            disabled={!canAddRule}
          >
            + New rule
          </Button>
          {!canAddRule && (
            <p className="mb-3 rounded-2xl border border-accent-amber/18 bg-accent-amber/10 p-3 text-xs leading-relaxed text-accent-amber">
              Nine rules max. Delete a rule before adding another so every rule keeps a number
              shortcut.
            </p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={rulePresets.map((preset) => preset.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid gap-2">
                {rulePresets.map((preset, index) => (
                  <SortableRuleButton
                    key={preset.id}
                    preset={preset}
                    index={index}
                    selected={selectedId === preset.id}
                    active={activeRulePresetId === preset.id}
                    onSelect={() => setSelectedId(preset.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </aside>
        <div className={`min-h-0 overscroll-contain overflow-y-auto p-6 ${hiddenScrollbarClass}`}>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-semibold text-text-secondary">
              Title
              <input
                className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm text-text-primary outline-hidden focus:border-accent-blue/70"
                value={title}
                disabled={disabled || busy}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-text-secondary">
              Description
              <input
                className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm text-text-primary outline-hidden focus:border-accent-blue/70"
                value={description}
                disabled={disabled || busy}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="Short switcher card summary"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-text-secondary">
              Rules Markdown
              <AutoGrowTextarea
                className="min-h-56 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm leading-relaxed text-text-primary outline-hidden focus:border-accent-blue/70"
                value={body}
                disabled={disabled || busy}
                onChange={(event) => setBody(event.currentTarget.value)}
              />
            </label>
            {selected && activeRulePresetId === selected.id && (
              <p className="m-0 rounded-xl border border-white/6 bg-white/3 px-3 py-2 text-xs leading-relaxed text-text-tertiary">
                Active rules cannot be deleted. Switch to another rule first; succession planning,
                but tiny.
              </p>
            )}
            {error && (
              <div className="rounded-xl border border-accent-red/20 bg-accent-red/10 px-3 py-2 text-sm text-accent-red">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function DictionaryModal({
  entries,
  disabled,
  client,
  onClose,
}: {
  entries: DictionaryEntrySummary[];
  disabled: boolean;
  client: DesktopApi;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const [term, setTerm] = useState('');
  const [hint, setHint] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setTerm(selected.term);
    setHint(selected.hint ?? '');
    setEnabled(selected.enabled);
  }, [selected]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Dictionary update failed. The words rebelled.',
      );
    } finally {
      setBusy(false);
    }
  };

  const draft = (): DictionaryEntryDraft => ({ term, hint: hint.trim() ? hint : null, enabled });

  return (
    <ModalShell
      eyebrow="Dictionary"
      title="Teach Toph your words"
      titleId="dictionary-modal-title"
      description="Add names, acronyms, product terms, and hints. I will use them cautiously during polish, not like a chaotic find-and-replace gremlin."
      size="lg"
      onClose={onClose}
      footer={
        <>
          {selected && (
            <Button
              variant="danger"
              onClick={() => void run(() => client.deleteDictionaryEntry(selected.id))}
              disabled={disabled || busy}
            >
              Delete
            </Button>
          )}
          {selected ? (
            <Button
              variant="primary"
              onClick={() => void run(() => client.updateDictionaryEntry(selected.id, draft()))}
              disabled={disabled || busy}
            >
              Save
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void run(() => client.createDictionaryEntry(draft()))}
              disabled={disabled || busy}
            >
              Add term
            </Button>
          )}
        </>
      }
    >
      <div className="grid h-full min-h-0 overflow-hidden grid-cols-[17rem_minmax(0,1fr)] max-[820px]:grid-cols-1 max-[820px]:grid-rows-[minmax(0,14rem)_minmax(0,1fr)]">
        <aside
          className={`min-h-0 overscroll-contain overflow-y-auto border-r border-white/6 p-4 max-[820px]:border-r-0 max-[820px]:border-b ${hiddenScrollbarClass}`}
        >
          <Button
            className="mb-3 w-full"
            onClick={() => {
              setSelectedId(null);
              setTerm('');
              setHint('');
              setEnabled(true);
            }}
          >
            + Add term
          </Button>
          <div className="grid gap-2">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`rounded-2xl border px-3 py-3 text-left transition-colors duration-200 ${selectedId === entry.id ? 'border-accent-cyan/45 bg-accent-cyan/10' : 'border-white/6 bg-white/3 hover:bg-white/6'}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${entry.enabled ? 'bg-accent-green' : 'bg-text-tertiary'}`}
                  />
                  <span className="min-w-0 truncate text-sm font-semibold text-text-primary">
                    {entry.term}
                  </span>
                </div>
                <span className="mt-1 line-clamp-2 text-xs leading-snug text-text-tertiary">
                  {entry.hint || 'No hint yet'}
                </span>
              </button>
            ))}
            {entries.length === 0 && (
              <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-text-tertiary">
                No words taught yet. Suspiciously clean vocabulary.
              </p>
            )}
          </div>
        </aside>
        <div className={`min-h-0 overscroll-contain overflow-y-auto p-6 ${hiddenScrollbarClass}`}>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-semibold text-text-secondary">
              Term
              <input
                className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm text-text-primary outline-hidden focus:border-accent-cyan/70"
                value={term}
                disabled={disabled || busy}
                onChange={(event) => setTerm(event.currentTarget.value)}
                placeholder="Toph"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-text-secondary">
              Hint optional
              <AutoGrowTextarea
                className="min-h-32 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm leading-relaxed text-text-primary outline-hidden focus:border-accent-cyan/70"
                value={hint}
                disabled={disabled || busy}
                onChange={(event) => setHint(event.currentTarget.value)}
                placeholder="Proper noun. The app I am building. Sounds like toff."
              />
            </label>
            <div className="rounded-2xl border border-white/6 bg-white/3 p-4 text-sm text-text-secondary">
              <div className="mb-2 font-semibold text-text-primary">Hint examples</div>
              <div className="grid gap-1 text-xs leading-relaxed text-text-tertiary">
                <span>- Sounds like "toff"</span>
                <span>- Proper noun: the app I am building</span>
                <span>- If transcript says "whisper flow", prefer "Wispr Flow"</span>
                <span>- Preserve capitalization as "JWT"</span>
              </div>
            </div>
            <SettingsSwitch
              checked={enabled}
              disabled={disabled || busy}
              label="Dictionary entry enabled"
              onCheckedChange={setEnabled}
            />
            {error && (
              <div className="rounded-xl border border-accent-red/20 bg-accent-red/10 px-3 py-2 text-sm text-accent-red">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function PolishSection({
  id,
  enabled,
  activeRulePresetId,
  rulePresets,
  dictionary,
  typingWpm,
  disabled,
  client,
  onEnabledChange,
  onTypingWpmChange,
}: {
  id?: string;
  enabled: boolean;
  activeRulePresetId: string | null;
  rulePresets: PolishRulePresetSummary[];
  dictionary: DictionaryEntrySummary[];
  typingWpm: number;
  disabled: boolean;
  client: DesktopApi;
  onEnabledChange: (enabled: boolean) => void;
  onTypingWpmChange: (typingWpm: number) => void;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const activeRule = rulePresets.find((preset) => preset.id === activeRulePresetId);
  const enabledDictionaryCount = dictionary.filter((entry) => entry.enabled).length;

  return (
    <>
      <SettingsSection
        id={id}
        eyebrow="Writing & Dictionary"
        description="Control how Toph rewrites your dictation and teach it the words it should know."
      >
        <SettingsRow
          label="Polish Dictation"
          description="When disabled, Toph pastes the raw assembled transcript."
          icon={
            <SettingsIcon tone="green">
              <WandSparkles size={17} strokeWidth={1.8} />
            </SettingsIcon>
          }
        >
          <SettingsSwitch
            checked={enabled}
            disabled={disabled}
            label="Polish Dictation"
            onCheckedChange={onEnabledChange}
          />
        </SettingsRow>
        <SettingsRow
          label="Rules"
          description={activeRule ? activeRule.title : 'Choose a preset to finish setup.'}
        >
          <Button onClick={() => setRulesOpen(true)} disabled={disabled}>
            Manage
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Dictionary"
          description={`${dictionary.length} terms, ${enabledDictionaryCount} active`}
        >
          <Button onClick={() => setDictionaryOpen(true)} disabled={disabled}>
            Manage
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Typing Speed"
          description="Used to estimate personalized time saved on the dashboard."
        >
          <SettingsNumberInput
            value={typingWpm}
            min={20}
            max={200}
            disabled={disabled}
            onChange={onTypingWpmChange}
          />
          <span className="text-xs font-semibold text-text-tertiary">WPM</span>
        </SettingsRow>
      </SettingsSection>

      {rulesOpen && (
        <RulesModal
          rulePresets={rulePresets}
          activeRulePresetId={activeRulePresetId}
          disabled={disabled}
          client={client}
          onClose={() => setRulesOpen(false)}
        />
      )}
      {dictionaryOpen && (
        <DictionaryModal
          entries={dictionary}
          disabled={disabled}
          client={client}
          onClose={() => setDictionaryOpen(false)}
        />
      )}
    </>
  );
}
