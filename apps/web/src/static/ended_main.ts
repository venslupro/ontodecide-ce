/**
 * @fileoverview Entry of `ended.html` (static /ended hard load): styles, the
 * stored theme and the framework-free page, nothing else.
 */

import '../styles/globals.css';
import {initTheme} from '../shared/lib/theme';
import {bootEnded} from './ended_static';

initTheme();
bootEnded();
