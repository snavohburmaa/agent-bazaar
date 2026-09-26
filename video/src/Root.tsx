import { Composition } from "remotion";
import { Video, FPS, DURATION } from "./Video";
export const Root = () => (
  <Composition id="AgentBazaar" component={Video} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
);
