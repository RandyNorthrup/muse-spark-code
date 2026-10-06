import {
  MAKER_VERTEX_COMPONENTS,
  MAKER_PREVIEW_CANVAS_SIZE,
  MAKER_PREVIEW_FRAME_SCALE,
  MAKER_PREVIEW_ROTATION_STEP,
  MAKER_PREVIEW_ZOOM_STEP,
  MAKER_PREVIEW_MIN_ZOOM,
  MAKER_PREVIEW_MAX_ZOOM,
} from '../../shared/makerPreviewConstants'

const VERTEX = `attribute vec3 position;
uniform float angle; uniform float scale;
varying vec3 surface;
void main() {
  float c = cos(angle); float s = sin(angle);
  vec3 p = vec3(c*position.x+s*position.z, position.y, -s*position.x+c*position.z);
  surface = p; gl_Position = vec4(p*scale, 1.0);
}`
const FRAGMENT = `#extension GL_OES_standard_derivatives : enable
precision mediump float; varying vec3 surface;
void main() {
  vec3 normal = normalize(cross(dFdx(surface), dFdy(surface)));
  float light = 0.35 + 0.65*abs(dot(normal, normalize(vec3(0.3,0.5,1.0))));
  gl_FragColor = vec4(vec3(0.3,0.65,0.95)*light,1.0);
}`

function requireResource<Resource>(value: Resource | null): Resource {
  if (value === null) throw new Error('webglResource')
  return value
}

/** Fixed orthographic framing. Geometry has already passed makerMesh's bounds. */
export function createMeshRenderer(canvas: HTMLCanvasElement, positions: readonly number[]) {
  const gl = canvas.getContext('webgl')
  if (gl?.getExtension('OES_standard_derivatives') == null) throw new Error('webglUnavailable')
  const shaders: WebGLShader[] = []
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  const dispose = () => {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    if (buffer !== null) gl.deleteBuffer(buffer)
    if (program !== null) gl.deleteProgram(program)
    for (const shader of shaders) gl.deleteShader(shader)
    buffer = null
    program = null
    shaders.length = 0
  }
  try {
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)
      if (shader === null) throw new Error('webglShader')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) throw new Error('webglShader')
      return shader
    }
    program = requireResource(gl.createProgram())
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) throw new Error('webglProgram')
    const attribute = gl.getAttribLocation(program, 'position')
    const angleUniform = gl.getUniformLocation(program, 'angle')
    const scaleUniform = gl.getUniformLocation(program, 'scale')
    if (angleUniform === null || scaleUniform === null || attribute < 0)
      throw new Error('webglLayout')
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const [at, position] of positions.entries()) {
      const axis = at % MAKER_VERTEX_COMPONENTS
      min[axis] = Math.min(min[axis] ?? Infinity, position)
      max[axis] = Math.max(max[axis] ?? -Infinity, position)
    }
    const extent = Math.hypot(...min.map((value, axis) => (max[axis] ?? value) - value)) || 1
    const normalized = Float32Array.from(
      positions,
      (value, at) =>
        ((value -
          ((min[at % MAKER_VERTEX_COMPONENTS] ?? 0) + (max[at % MAKER_VERTEX_COMPONENTS] ?? 0)) /
            2) /
          extent) *
        2 *
        MAKER_PREVIEW_FRAME_SCALE,
    )
    buffer = requireResource(gl.createBuffer())
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, normalized, gl.STATIC_DRAW)
    gl.useProgram(program)
    gl.enableVertexAttribArray(attribute)
    gl.vertexAttribPointer(attribute, MAKER_VERTEX_COMPONENTS, gl.FLOAT, false, 0, 0)
    gl.enable(gl.DEPTH_TEST)
    canvas.width = MAKER_PREVIEW_CANVAS_SIZE
    canvas.height = MAKER_PREVIEW_CANVAS_SIZE
    let angle = 0
    let scale = 1
    const draw = () => {
      if (program === null) return
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.uniform1f(angleUniform, angle)
      gl.uniform1f(scaleUniform, scale)
      gl.drawArrays(gl.TRIANGLES, 0, positions.length / MAKER_VERTEX_COMPONENTS)
    }
    draw()
    return {
      rotate: (direction: number) => {
        angle += direction * MAKER_PREVIEW_ROTATION_STEP
        draw()
      },
      zoom: (direction: number) => {
        scale = Math.max(
          MAKER_PREVIEW_MIN_ZOOM,
          Math.min(MAKER_PREVIEW_MAX_ZOOM, scale * MAKER_PREVIEW_ZOOM_STEP ** direction),
        )
        draw()
      },
      reset: () => {
        angle = 0
        scale = 1
        draw()
      },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
