import React from 'react';
import {Composition, Sequence, registerRoot} from 'remotion';
import {Opening, Recorded, Motion, Closing} from './Scenes';
import './style.css';
const Film: React.FC = () => <>
  <Sequence from={0} durationInFrames={105}><Opening/></Sequence>
  <Sequence from={105} durationInFrames={135}><Recorded file="studio-public-journey.webm" start={0} title="Explore the public gallery" subtitle="Recorded from the public Studio Share browser"/></Sequence>
  <Sequence from={240} durationInFrames={150}><Recorded file="studio-public-journey.webm" start={300} title="Find the source" subtitle="Searching Woodhouse Share artwork"/></Sequence>
  <Sequence from={390} durationInFrames={120}><Recorded file="studio-public-journey.webm" start={600} title="Follow the credit" subtitle="NEW-073 · artwork and source details"/></Sequence>
  <Sequence from={510} durationInFrames={150}><Recorded file="ldraw-insert-20261114.webm" start={1380} title="Use artwork in LDraw" subtitle="Recorded local preview · inserting NEW-073"/></Sequence>
  <Sequence from={660} durationInFrames={175}><Motion/></Sequence>
  <Sequence from={835} durationInFrames={105}><Closing/></Sequence>
</>;
const Root: React.FC = () => <Composition id="StudioProof" component={Film} durationInFrames={940} fps={30} width={1280} height={720}/>;
registerRoot(Root);
