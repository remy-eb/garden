import {
  Module,
  ModuleSpec,
} from "../../../types/module"
import {
  Service,
  ServiceSpec,
} from "../../../types/service"
import { GenericTestSpec } from "../../generic"

export abstract class AwsModule<
  M extends ModuleSpec = ModuleSpec,
  S extends ServiceSpec = ServiceSpec,
  T extends GenericTestSpec = GenericTestSpec,
  > extends Module<M, S, T> { }

export abstract class AwsService<T extends AwsModule> extends Service<T> { }
