import { Shell } from './Shell'
import { useStore } from './store'
import { StartScreen } from './StartScreen'
import { ProcessingScreen, ClipsScreen, ProjectsScreen } from './ClipScreens'
import { EditorScreen } from './EditorScreen'
import { StudioScreen, ModelsScreen, SettingsScreen } from './OtherScreens'
import './tokens.css'

export default function ShortmeApp(): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  return (
    <Shell>
      {screen === 'start' && <StartScreen />}
      {screen === 'projects' && <ProjectsScreen />}
      {screen === 'processing' && <ProcessingScreen />}
      {screen === 'clips' && <ClipsScreen />}
      {screen === 'editor' && <EditorScreen />}
      {screen === 'studio' && <StudioScreen />}
      {screen === 'models' && <ModelsScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </Shell>
  )
}
