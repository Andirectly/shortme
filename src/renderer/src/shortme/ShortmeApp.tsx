import { useEffect } from 'react'
import { Shell } from './Shell'
import { useStore } from './store'
import { useEngines } from './engines'
import { StartScreen } from './StartScreen'
import { ProcessingScreen, ClipsScreen, ProjectsScreen } from './ClipScreens'
import { EditorScreen } from './EditorScreen'
import { StudioScreen, SettingsScreen } from './OtherScreens'
import { ModelsScreen, SetupWizard } from './ModelsScreen'
import './tokens.css'

export default function ShortmeApp(): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  const init = useEngines((s) => s.init)
  useEffect(() => { void init() }, [init])
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
      <SetupWizard />
    </Shell>
  )
}
