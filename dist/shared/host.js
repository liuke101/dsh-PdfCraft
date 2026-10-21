/**
 * The slice of the harness host context both components are written against.
 *
 * The bundle is loaded into a Cordis fiber, but the facilities it uses are few
 * and stable: the effect scope that owns every registration, the logger, and
 * the service registry. Describing them structurally keeps the components
 * usable from a plain recording object in the suite without pulling the whole
 * harness type graph, which lives in packages this bundle does not install,
 * into the build.
 *
 * Types shared by the two entries live here so neither component imports the
 * other: the Web Component serves the Panel, the CLI Component runs the
 * engines, and the only thing they have in common is the host they activate in.
 */
export {};
