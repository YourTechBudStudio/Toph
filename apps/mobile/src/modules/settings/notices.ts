export interface Notice {
  readonly name: string;
  readonly usedFor: string;
  readonly url: string;
  readonly license: 'MIT' | 'ISC' | 'OFL-1.1';
  readonly text: string;
}

export interface NoticeGroup {
  readonly title: string;
  readonly notices: readonly Notice[];
}

/** The permission paragraphs every MIT license shares, after its copyright line. */
const mitTerms = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const mit = (copyright: string) => `MIT License\n\n${copyright}\n\n${mitTerms}`;

const iscTerms = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const oflTerms = `This Font Software is licensed under the SIL Open Font License, Version 1.1.

This license is copied below, and is also available with a FAQ at: https://scripts.sil.org/OFL

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide development of collaborative font projects, to support the font creation efforts of academic and linguistic communities, and to provide a free and open framework in which fonts may be shared and improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and redistributed freely as long as they are not sold by themselves. The fonts, including any derivative works, can be bundled, embedded, redistributed and/or sold with any software provided that any reserved names are not used by derivative works. The fonts and derivatives, however, cannot be released under any other type of license. The requirement for fonts to remain under this license does not apply to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright Holder(s) under this license and clearly marked as such. This may include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the copyright statement(s).

"Original Version" refers to the collection of Font Software components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting, or substituting -- in part or in whole -- any of the components of the Original Version, by changing formats or by porting the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled, redistributed and/or sold with any software, provided that each copy contains the above copyright notice and this license. These can be included either as stand-alone text files, human-readable headers or in the appropriate machine-readable metadata fields within text or binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted by the corresponding Copyright Holder. This restriction only applies to the primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software shall not be used to promote, endorse or advertise any Modified Version, except to acknowledge the contribution(s) of the Copyright Holder(s) and the Author(s) or with their explicit written permission.

5) The Font Software, modified or unmodified, in part or in whole, must be distributed entirely under this license, and must not be distributed under any other license. The requirement for fonts to remain under this license does not apply to any document created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.`;

const ofl = (copyright: string) => `${copyright}\n\n${oflTerms}`;

/** Lucide ships Feather's MIT notice for the icons it took from Feather, so it is kept whole. */
const lucide = `ISC License

Copyright (c) 2026 Lucide Icons and Contributors

${iscTerms}

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

${mitTerms}`;

/**
 * Third-party work shipped inside the app: the voice engine, the runtime libraries the release
 * build bundles, and the fonts. Build-only and debug-only tools are left out. Each text is the
 * project's LICENSE with the copyright line verbatim and line breaks inside paragraphs removed, so
 * it wraps on a phone. Add a row when a dependency joins the release build.
 */
export const noticeGroups: readonly NoticeGroup[] = [
  {
    title: 'Voice engine',
    notices: [
      {
        name: 'Silero VAD',
        usedFor: 'Voice detection (model silero_vad_v5.onnx)',
        url: 'https://github.com/snakers4/silero-vad',
        license: 'MIT',
        text: mit('Copyright (c) 2020-present Silero Team'),
      },
      {
        name: 'ONNX Runtime',
        usedFor: 'Running the voice detection model',
        url: 'https://github.com/microsoft/onnxruntime',
        license: 'MIT',
        text: mit('Copyright (c) Microsoft Corporation'),
      },
    ],
  },
  {
    title: 'App',
    notices: [
      {
        name: 'React Native',
        usedFor: 'The app framework',
        url: 'https://github.com/facebook/react-native',
        license: 'MIT',
        text: mit('Copyright (c) Meta Platforms, Inc. and affiliates.'),
      },
      {
        name: 'React',
        usedFor: 'Building the interface',
        url: 'https://github.com/facebook/react',
        license: 'MIT',
        text: mit('Copyright (c) Meta Platforms, Inc. and affiliates.'),
      },
      {
        name: 'Hermes',
        usedFor: "Running the app's JavaScript",
        url: 'https://github.com/facebook/hermes',
        license: 'MIT',
        text: mit('Copyright (c) Meta Platforms, Inc. and affiliates.'),
      },
      {
        name: 'Expo',
        usedFor: 'Native modules, routing and the app shell',
        url: 'https://github.com/expo/expo',
        license: 'MIT',
        text: mit('Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)'),
      },
      {
        name: 'React Native Reanimated',
        usedFor: 'Animations',
        url: 'https://github.com/software-mansion/react-native-reanimated',
        license: 'MIT',
        text: mit('Copyright (c) 2016 Software Mansion <swmansion.com>'),
      },
      {
        name: 'React Native Worklets',
        usedFor: 'Running animations off the main thread',
        url: 'https://github.com/software-mansion/react-native-reanimated',
        license: 'MIT',
        text: mit('Copyright (c) 2024 nobody'),
      },
      {
        name: 'React Native Screens',
        usedFor: 'Native screen navigation',
        url: 'https://github.com/software-mansion/react-native-screens',
        license: 'MIT',
        text: mit('Copyright (c) 2018 Software Mansion <swmansion.com>'),
      },
      {
        name: 'React Native Safe Area Context',
        usedFor: 'Keeping content clear of system bars',
        url: 'https://github.com/AppAndFlow/react-native-safe-area-context',
        license: 'MIT',
        text: mit('Copyright (c) 2019 Th3rd Wave'),
      },
      {
        name: 'React Native SVG',
        usedFor: 'Drawing vector graphics',
        url: 'https://github.com/software-mansion/react-native-svg',
        license: 'MIT',
        text: mit('Copyright (c) [2015-2016] [Horcrux]'),
      },
      {
        name: 'Uniwind',
        usedFor: 'Styling',
        url: 'https://github.com/uni-stack/uniwind',
        license: 'MIT',
        text: mit('Copyright (c) 2026 Uniwind'),
      },
      {
        name: 'Zustand',
        usedFor: 'App state',
        url: 'https://github.com/pmndrs/zustand',
        license: 'MIT',
        text: mit('Copyright (c) 2019 Paul Henschel'),
      },
      {
        name: 'Zod',
        usedFor: "Checking data in Toph's shared dictation core",
        url: 'https://github.com/colinhacks/zod',
        license: 'MIT',
        text: mit('Copyright (c) 2025 Colin McDonnell'),
      },
      {
        name: 'Lucide',
        usedFor: 'Icons',
        url: 'https://github.com/lucide-icons/lucide',
        license: 'ISC',
        text: lucide,
      },
    ],
  },
  {
    title: 'Fonts',
    notices: [
      {
        name: 'Sora',
        usedFor: 'Headings',
        url: 'https://github.com/sora-xor/sora-font',
        license: 'OFL-1.1',
        text: ofl(
          'Copyright 2019 The Sora Project Authors (https://github.com/sora-xor/sora-font)',
        ),
      },
      {
        name: 'Source Sans 3',
        usedFor: 'Body text',
        url: 'https://github.com/adobe-fonts/source-sans',
        license: 'OFL-1.1',
        text: ofl(
          "Copyright 2010-2020 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. All Rights Reserved. Source is a trademark of Adobe in the United States and/or other countries.",
        ),
      },
    ],
  },
];
