import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '../theme';
import { cn } from './cn';

/**
 * A labelled text input. `secret` masks the value behind an eye toggle; `plain` turns off
 * capitalization and autocorrect for URLs and identifiers; `multiline` grows a tall editor for
 * prose such as rules.
 */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  secret = false,
  plain = false,
  multiline = false,
  keyboardType,
  editable = true,
  onBlur,
  autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string | undefined;
  hint?: string | undefined;
  secret?: boolean | undefined;
  plain?: boolean | undefined;
  multiline?: boolean | undefined;
  keyboardType?: 'default' | 'url' | undefined;
  editable?: boolean | undefined;
  onBlur?: (() => void) | undefined;
  autoFocus?: boolean | undefined;
}) {
  const literal = secret || plain;
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <View>
      <Text className="mb-2 font-body-semibold text-sm text-text-secondary">{label}</Text>
      <View
        className={cn(
          'flex-row rounded-tile border bg-black/15 px-4',
          !editable && 'opacity-50',
          multiline ? 'items-start' : 'h-13 items-center',
          focused ? 'border-spark/60' : 'border-line-strong',
        )}
      >
        <TextInput
          accessibilityLabel={label}
          autoCapitalize={literal ? 'none' : 'sentences'}
          autoCorrect={!literal}
          autoFocus={autoFocus ?? false}
          className={cn(
            'flex-1 font-body text-base text-text-primary',
            multiline && 'min-h-56 py-3.5 leading-6',
          )}
          cursorColor={colors.spark}
          editable={editable}
          keyboardType={keyboardType ?? 'default'}
          multiline={multiline}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          placeholder={placeholder ?? ''}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={secret && !revealed}
          selectionColor={colors.spark}
          textAlignVertical={multiline ? 'top' : 'center'}
          value={value}
        />
        {secret ? (
          <Pressable
            accessibilityLabel={revealed ? 'Hide value' : 'Show value'}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setRevealed((current) => !current)}
          >
            {revealed ? (
              <EyeOff color={colors.textTertiary} size={19} strokeWidth={1.8} />
            ) : (
              <Eye color={colors.textTertiary} size={19} strokeWidth={1.8} />
            )}
          </Pressable>
        ) : null}
      </View>
      {hint === undefined ? null : (
        <Text className="mt-2 font-body text-[13px] leading-5 text-text-tertiary">{hint}</Text>
      )}
    </View>
  );
}
