import { ArrowUpRight, ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { BackBar, Card, colors, FadeIn, PageTitle, Screen, SectionLabel } from '../../../ui';
import { noticeGroups, type Notice } from '../notices';

/** The open-source work Toph ships, one card per project, each license a tap away. */
export function LicensesScreen() {
  return (
    <Screen header={<BackBar />}>
      <FadeIn index={0}>
        <PageTitle
          eyebrow="Settings"
          title="Open-source notices"
          description="Toph hears you with other people's good work. Here is who to thank."
        />
      </FadeIn>

      {noticeGroups.map((group, index) => (
        <FadeIn key={group.title} index={index + 1}>
          <View className="mt-9">
            <SectionLabel>{group.title}</SectionLabel>
            <View className="gap-3">
              {group.notices.map((notice) => (
                <NoticeCard key={notice.name} notice={notice} />
              ))}
            </View>
          </View>
        </FadeIn>
      ))}
    </Screen>
  );
}

/** Name, purpose and link always show; the license text opens on tap. */
function NoticeCard({ notice }: { notice: Notice }) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <Pressable
        accessibilityLabel={`${notice.name} license`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-3"
        onPress={() => setOpen((value) => !value)}
      >
        <View className="flex-1">
          <Text className="font-display text-lg text-text-primary">{notice.name}</Text>
          <Text className="mt-0.5 font-body text-sm text-text-secondary">{notice.usedFor}</Text>
        </View>
        <Text className="rounded-full bg-white/6 px-2 py-0.5 font-body-semibold text-[11px] text-text-tertiary">
          {notice.license}
        </Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <ChevronDown color={colors.textTertiary} size={18} strokeWidth={2} />
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`Open ${notice.name} on GitHub`}
        accessibilityRole="link"
        className="mt-2 flex-row items-center gap-1 self-start"
        hitSlop={8}
        onPress={() => void Linking.openURL(notice.url)}
      >
        <Text className="font-body-semibold text-[13px] text-text-secondary">
          {notice.url.replace('https://', '')}
        </Text>
        <ArrowUpRight color={colors.textSecondary} size={14} strokeWidth={2} />
      </Pressable>
      {open ? (
        <>
          <View className="mt-4 h-px bg-line" />
          <Text selectable className="mt-4 font-body text-[13px] leading-5 text-text-tertiary">
            {notice.text}
          </Text>
        </>
      ) : null}
    </Card>
  );
}
