// THROWAWAY MOCK route for the story #8 keyboard UI exploration. Open with
// `adb shell am start -a android.intent.action.VIEW -d "toph-dev://mock/keyboard"`.
import { KeyboardMockScreen } from '../../modules/keyboard';

export default function KeyboardMockRoute() {
  return <KeyboardMockScreen />;
}
