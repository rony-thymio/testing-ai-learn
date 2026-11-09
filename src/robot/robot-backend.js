import { thymio, EVENTS } from '../api.js';
import { MODULE_NAME, MODULE_TEXT, AI_MODULE_NAME, AI_MODULE_TEXT } from '../script.js';
import { RobotBackendCore } from './robot-backend-core.js';

// The real robot, over Web Bluetooth (see robot-backend-core.js): the mode is installed once on the robot as the module
// `MODULE_NAME` and started by a two-line launcher; the whole mode is the fallback. The AI Lab program likewise, as
// `AI_MODULE_NAME`, the first time it is started.
export class RobotBackend extends RobotBackendCore {
  constructor(emit, options = {}) {
    super(emit, {
      thymio,
      events: EVENTS,
      module: { name: MODULE_NAME, text: MODULE_TEXT },
      aiModule: { name: AI_MODULE_NAME, text: AI_MODULE_TEXT },
      ...options,
    });
  }
}
