import theme from '../../../data/ui-theme.json' with { type: 'json' };
export {theme};
export function themeVariables() {
  const vars={};
  for(const [k,v] of Object.entries(theme.color))vars['--t-'+k]=v;
  for(const [k,v] of Object.entries(theme.typography.families))vars['--t-font-'+k]=v;
  for(const [k,v] of Object.entries(theme.typography.scale)){
    vars['--t-size-'+k]=v.size+'px';vars['--t-weight-'+k]=v.weight;
    vars['--t-tracking-'+k]=v.letterSpacing;
  }
  for(const [k,v] of Object.entries(theme.motion.duration))vars['--t-time-'+k]=v+'ms';
  for(const [k,v] of Object.entries(theme.motion.easing))vars['--t-ease-'+k]=v;
  for(const [k,v] of Object.entries(theme.shape.clip))vars['--t-clip-'+k]=v;
  for(const n of theme.spacing.scale)vars['--t-space-'+n]=n+'px';
  vars['--t-focus']=theme.shape.focusRing;
  for(const [k,v] of Object.entries(theme.terminal.layout))vars['--t-'+k]=typeof v==='number'?v+'px':v;
  return vars;
}
